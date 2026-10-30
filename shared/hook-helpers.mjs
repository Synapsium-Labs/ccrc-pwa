// ARCH-74 (#809), K18: the helpers a sibling executable shares byte for byte with `ccd/ccd` are GENERATED into it,
// not hand-copied. Each such sibling is installed alone and sources nothing, so it cannot call ccd's functions; it
// carries a copy, and this module is the one writer of every copy.
//
// The regions, one row each in `REGIONS` below (one engine, never a second module):
//
//   | region     | target                    | what is generated, and from where                                     |
//   |------------|---------------------------|-----------------------------------------------------------------------|
//   | `hook`     | `ccd/session-hook.sh`     | `_hook_epoch_ms`, from the body of `_plat_epoch_ms` in `ccd/ccd`'s     |
//   |            |                           | platform block (the name differs, the body may not); `CCRC_PROJ_CLASS`,|
//   |            |                           | `CCRC_PROJ_MAX` and `CCRC_ID_MAX`, from `HOOK_CONSTANTS` below, which  |
//   |            |                           | are their one definition                                              |
//   | `authdead` | `ccd/ccd-account-health`  | `_authdead_mark`, `_authdead_clear` and `_authdead_sweep_staged`: byte |
//   |            |                           | copies of their definitions in `ccd/ccd` (D-7049; ARCH-72, spec K16)   |
//   | `apicap`   | `ccd/ccrc-api`            | `_api_server_cap`, from the body of `_hook_server_cap` in the          |
//   |            |                           | `ccd/session-hook.sh` beside the given ccd (the name differs, the body |
//   |            |                           | may not; D-7321, D-7329)                                              |
//   | `log-line` | `ccd/ccd-update-sync`     | `_upd_redact`, a byte copy of its definition in `ccd/ccrc`, the one   |
//   |            |                           | bash log-line redactor (W5 C5i; D-7078, D-7289)                       |
//
// Nothing else is: the hook's compaction-lock region differs from ccd's on purpose (its own exit-0 contract and rc-2
// arms), so it stays hand-written.
//
// Each copy sits between its region's BEGIN and END lines and carries the same `# ccrc:generated 1 sha256=…` stamp
// `shared/mark.mjs` writes, over the region's own body, so the stamp tells a regenerated region from a hand-edited
// one. Regenerate with
//   ccrc restamp ccd/session-hook.sh        (or ccd/ccd-account-health, ccd/ccrc-api, ccd/ccd-update-sync)
// (the one regeneration verb; it calls this module with the file the region's row names, in the tree's own ccd/). The `--write` / `--check` / `--restamp`
// CLI below is the engine's entry: each takes the target file and dispatches on the region it carries. A pure byte
// copy, not a `source`: a runtime-sourced sibling is refused by the architecture spec.
//
// Plain ESM with no npm imports, like `shared/mark.mjs`, so `deploy/` and the tests can run it with a bare `node`.

import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { markGenerated, verifyMarker } from './mark.mjs';

/** The hook's project/session-id shape, bounds and read cap: one definition. */
export const HOOK_CONSTANTS = Object.freeze({
  CCRC_PROJ_CLASS: 'A-Za-z0-9._-',
  CCRC_PROJ_MAX: 64,
  CCRC_ID_MAX: 128,
});

export const HOOK_REGION_BEGIN = '# ── BEGIN GENERATED HOOK HELPERS (shared/hook-helpers.mjs; edit that, then regenerate) ──';
export const HOOK_REGION_END = '# ── END GENERATED HOOK HELPERS ──';

export const AUTHDEAD_REGION_BEGIN = '# ── BEGIN GENERATED AUTH-DEAD WRITERS (shared/hook-helpers.mjs; edit them in ccd/ccd, then regenerate) ──';
export const AUTHDEAD_REGION_END = '# ── END GENERATED AUTH-DEAD WRITERS ──';

export const APICAP_REGION_BEGIN = '# ── BEGIN GENERATED SERVER-CAP READER (shared/hook-helpers.mjs; edit _hook_server_cap in ccd/session-hook.sh, then regenerate) ──';
export const APICAP_REGION_END = '# ── END GENERATED SERVER-CAP READER ──';

export const LOGLINE_REGION_BEGIN = '# ── BEGIN GENERATED LOG-LINE REDACTOR (shared/hook-helpers.mjs; edit it in ccd/ccrc, then regenerate) ──';
export const LOGLINE_REGION_END = '# ── END GENERATED LOG-LINE REDACTOR ──';

/** The auth-dead marker's writers (D-7049), in their `ccd/ccd` definition order. */
export const AUTHDEAD_WRITERS = Object.freeze(['_authdead_mark', '_authdead_clear', '_authdead_sweep_staged']);

/** The body of ccd's `_plat_epoch_ms`, or null when ccd has no such function. */
export function ccdEpochBody(ccdSrc) {
  const m = /^_plat_epoch_ms\(\) \{[^\n]*\n([\s\S]*?)\n\}$/m.exec(ccdSrc);
  return m ? m[1] : null;
}

/** A bash source's whole definition of `name` (its column-0 `name() {` line through its column-0 `}`, or the one line
 *  of a one-line definition), or null. Named for ccd, its first source; it reads only the text it is given. */
export function ccdFunctionDefinition(ccdSrc, name) {
  const at = new RegExp(`^${name}\\(\\) \\{[^\\n]*$`, 'm').exec(ccdSrc);
  if (!at) return null;
  const first = at[0];
  if (/\}\s*(?:#[^{}]*)?$/.test(first) && !/\{\s*(?:#.*)?$/.test(first)) return first;
  const close = /^\}[^\n]*$/m;
  const rest = ccdSrc.slice(at.index + first.length);
  const c = close.exec(rest);
  return c ? ccdSrc.slice(at.index, at.index + first.length + c.index + c[0].length) : null;
}

/** The hook region's body (unstamped): the helper and the constants. */
export function renderHookBody(ccdSrc) {
  const body = ccdEpochBody(ccdSrc);
  if (body === null) throw new Error('ccd has no _plat_epoch_ms to generate _hook_epoch_ms from');
  const consts = Object.entries(HOOK_CONSTANTS).map(([k, v]) => (typeof v === 'string' ? `${k}='${v}'` : `${k}=${v}`));
  return `_hook_epoch_ms() {\n${body}\n}\n${consts.join('\n')}\n`;
}

/** The auth-dead region's body (unstamped): ccd's three writer definitions, byte for byte, in order. */
export function renderAuthdeadBody(ccdSrc) {
  return AUTHDEAD_WRITERS.map((name) => {
    const def = ccdFunctionDefinition(ccdSrc, name);
    if (def === null) throw new Error(`ccd has no ${name} to copy`);
    return `${def}\n`;
  }).join('');
}

/** The server-cap reader region's body (unstamped), from the HOOK's text: `_hook_server_cap`'s whole definition with
 *  its name line replaced by `_api_server_cap() {` (D-7321). */
export function renderApicapBody(src) {
  const def = ccdFunctionDefinition(src, '_hook_server_cap');
  if (def === null || !def.includes('\n')) throw new Error('the hook has no _hook_server_cap to generate _api_server_cap from');
  return `_api_server_cap() {\n${def.slice(def.indexOf('\n') + 1)}\n`;
}

/** The log-line redactor region's body (unstamped), from ccd/ccrc's text: `_upd_redact`'s whole definition, byte for
 *  byte (W5 C5i). */
export function renderLogLineBody(src) {
  const def = ccdFunctionDefinition(src, '_upd_redact');
  if (def === null) throw new Error('ccd/ccrc has no _upd_redact to copy');
  return `${def}\n`;
}

/** One row per generated region. `detect` is the BEGIN line's prefix a file carrying the region (whole or damaged)
 *  is recognised by; `label` is the words `ccrc restamp` reports it in; `source` is the text `render` reads: `ccd` (the
 *  given ccd) or `hook` (the `session-hook.sh` beside it, handed to that row only); `file` is the repository-relative
 *  path of the file the row is given, for the CLI's third argument and the engine's `ccdSrc` (a `source: 'hook'` row
 *  reads the hook beside it). */
export const REGIONS = Object.freeze([
  Object.freeze({ name: 'hook', label: 'hook helpers', begin: HOOK_REGION_BEGIN, end: HOOK_REGION_END,
    detect: '# ── BEGIN GENERATED HOOK HELPERS', source: 'ccd', file: 'ccd/ccd', render: renderHookBody }),
  Object.freeze({ name: 'authdead', label: 'auth-dead writers', begin: AUTHDEAD_REGION_BEGIN, end: AUTHDEAD_REGION_END,
    detect: '# ── BEGIN GENERATED AUTH-DEAD WRITERS', source: 'ccd', file: 'ccd/ccd', render: renderAuthdeadBody }),
  Object.freeze({ name: 'apicap', label: 'server-cap reader', begin: APICAP_REGION_BEGIN, end: APICAP_REGION_END,
    detect: '# ── BEGIN GENERATED SERVER-CAP READER', source: 'hook', file: 'ccd/ccd', render: renderApicapBody }),
  Object.freeze({ name: 'log-line', label: 'log-line redactor', begin: LOGLINE_REGION_BEGIN, end: LOGLINE_REGION_END,
    detect: '# ── BEGIN GENERATED LOG-LINE REDACTOR', source: 'ccd', file: 'ccd/ccrc', render: renderLogLineBody }),
]);

const HOOK = REGIONS[0];

/** The region row `src` carries (its BEGIN line's prefix, whole or damaged), or null. */
export function regionOf(src) {
  return REGIONS.find((r) => src.includes(r.detect)) ?? null;
}

/** The text `row` renders from: ccd's, or the sibling hook's for a `source: 'hook'` row. */
function sourceOf(row, ccdSrc, hookSrc) {
  const src = row.source === 'hook' ? hookSrc : ccdSrc;
  if (typeof src !== 'string') throw new Error(`the ${row.label} region renders from ${row.source === 'hook' ? 'the sibling session-hook.sh' : 'ccd'}, which was not given`);
  return src;
}

/** The whole stamped region, BEGIN and END lines included, ending in a newline. `ccdSrc` is the given text (the file
 *  the row names); `hookSrc` is read by the `apicap` row only. */
export function renderRegion(row, ccdSrc, hookSrc) {
  return `${row.begin}\n${markGenerated(row.render(sourceOf(row, ccdSrc, hookSrc)))}${row.end}\n`;
}

/** The region as `src` carries it (BEGIN..END lines), or null. */
export function extractRegion(row, src) {
  const b = src.indexOf(`${row.begin}\n`);
  if (b < 0) return null;
  const e = src.indexOf(`${row.end}\n`, b);
  return e < 0 ? null : src.slice(b, e + row.end.length + 1);
}

/** `src` with its region replaced by a fresh one from `ccdSrc`, the given text; throws when it carries no region. */
export function applyRegion(row, src, ccdSrc, hookSrc) {
  const old = extractRegion(row, src);
  if (old === null) throw new Error(`the file carries no generated ${row.label} region to regenerate`);
  return src.replace(old, () => renderRegion(row, ccdSrc, hookSrc));
}

/**
 * 'current' | 'missing' | 'edited' (stamp no longer matches the region's own
 * body) | 'stale' (stamp matches, but the given text, the hook or the constants have moved on).
 */
export function checkRegion(row, src, ccdSrc, hookSrc) {
  const region = extractRegion(row, src);
  if (region === null) return 'missing';
  const inner = region.slice(row.begin.length + 1, region.length - row.end.length - 1);
  if (verifyMarker(inner) !== 'ccrc-unmodified') return 'edited';
  return region === renderRegion(row, ccdSrc, hookSrc) ? 'current' : 'stale';
}

/** The hook's row, by its historical names. */
export const renderHookRegion = (ccdSrc) => renderRegion(HOOK, ccdSrc);
export const extractHookRegion = (hookSrc) => extractRegion(HOOK, hookSrc);
export const applyHookRegion = (hookSrc, ccdSrc) => applyRegion(HOOK, hookSrc, ccdSrc);
export const checkHookRegion = (hookSrc, ccdSrc) => checkRegion(HOOK, hookSrc, ccdSrc);

function startedAsScript() {
  const script = process.argv[1];
  if (!script) return false;
  try {
    return realpathSync(script) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (startedAsScript()) {
  const [mode, targetPath, ccdPath] = process.argv.slice(2);
  if (mode === '--regions') {
    // For `ccrc restamp`: each region's detect prefix and label, one tab-separated row per line.
    process.stdout.write(REGIONS.map((r) => `${r.detect}\t${r.label}\n`).join(''));
    process.exit(0);
  }
  if (mode === '--region-files') {
    // For `ccrc restamp`: as `--regions`, with the file each row is given as a third column (`--regions` keeps its two,
    // which an installed ccrc from before this mode reads).
    process.stdout.write(REGIONS.map((r) => `${r.detect}\t${r.label}\t${r.file}\n`).join(''));
    process.exit(0);
  }
  if ((mode !== '--write' && mode !== '--check' && mode !== '--restamp') || !targetPath || !ccdPath) {
    process.stderr.write('usage: node shared/hook-helpers.mjs --write|--check|--restamp <target> <ccd> | --regions\n');
    process.exit(2);
  }
  const target = readFileSync(targetPath, 'utf8');
  const ccd = readFileSync(ccdPath, 'utf8');
  const row = regionOf(target);
  // The `apicap` row renders from the hook beside the given ccd; no other row reads it.
  const hook = row?.source === 'hook' ? readFileSync(fileURLToPath(new URL('session-hook.sh', pathToFileURL(ccdPath))), 'utf8') : undefined;
  if (mode === '--restamp') {
    // One line for `ccrc restamp`: nothere | refused-missing | current | regenerated.
    let v;
    if (row === null) v = 'nothere';
    else if (extractRegion(row, target) === null) v = 'refused-missing';
    else if (checkRegion(row, target, ccd, hook) === 'current') v = 'current';
    else {
      writeFileSync(targetPath, applyRegion(row, target, ccd, hook));
      v = 'regenerated';
    }
    process.stdout.write(`${v}\n`);
  } else if (mode === '--write') {
    writeFileSync(targetPath, applyRegion(row ?? HOOK, target, ccd, hook));
    process.stdout.write('hook-helpers: regenerated\n');
  } else {
    const v = checkRegion(row ?? HOOK, target, ccd, hook);
    process.stdout.write(`hook-helpers: ${v}\n`);
    process.exit(v === 'current' ? 0 : 1);
  }
}
