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
//
// Nothing else is: the hook's compaction-lock region differs from ccd's on purpose (its own exit-0 contract and rc-2
// arms), so it stays hand-written.
//
// Each copy sits between its region's BEGIN and END lines and carries the same `# ccrc:generated 1 sha256=…` stamp
// `shared/mark.mjs` writes, over the region's own body, so the stamp tells a regenerated region from a hand-edited
// one. Regenerate with
//   ccrc restamp ccd/session-hook.sh        (or ccd/ccd-account-health)
// (the one regeneration verb; it calls this module with the tree's own ccd). The `--write` / `--check` / `--restamp`
// CLI below is the engine's entry: each takes the target file and dispatches on the region it carries. A pure byte
// copy, not a `source`: a runtime-sourced sibling is refused by the architecture spec.
//
// Plain ESM with no npm imports, like `shared/mark.mjs`, so `deploy/` and the tests can run it with a bare `node`.

import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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

/** The auth-dead marker's writers (D-7049), in their `ccd/ccd` definition order. */
export const AUTHDEAD_WRITERS = Object.freeze(['_authdead_mark', '_authdead_clear', '_authdead_sweep_staged']);

/** The body of ccd's `_plat_epoch_ms`, or null when ccd has no such function. */
export function ccdEpochBody(ccdSrc) {
  const m = /^_plat_epoch_ms\(\) \{[^\n]*\n([\s\S]*?)\n\}$/m.exec(ccdSrc);
  return m ? m[1] : null;
}

/** ccd's whole definition of `name` (its column-0 `name() {` line through its column-0 `}`, or the one line of a
 *  one-line definition), or null. */
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

/** One row per generated region. `detect` is the BEGIN line's prefix a file carrying the region (whole or damaged)
 *  is recognised by; `label` is the words `ccrc restamp` reports it in. */
export const REGIONS = Object.freeze([
  Object.freeze({ name: 'hook', label: 'hook helpers', begin: HOOK_REGION_BEGIN, end: HOOK_REGION_END,
    detect: '# ── BEGIN GENERATED HOOK HELPERS', render: renderHookBody }),
  Object.freeze({ name: 'authdead', label: 'auth-dead writers', begin: AUTHDEAD_REGION_BEGIN, end: AUTHDEAD_REGION_END,
    detect: '# ── BEGIN GENERATED AUTH-DEAD WRITERS', render: renderAuthdeadBody }),
]);

const HOOK = REGIONS[0];

/** The region row `src` carries (its BEGIN line's prefix, whole or damaged), or null. */
export function regionOf(src) {
  return REGIONS.find((r) => src.includes(r.detect)) ?? null;
}

/** The whole stamped region, BEGIN and END lines included, ending in a newline. */
export function renderRegion(row, ccdSrc) {
  return `${row.begin}\n${markGenerated(row.render(ccdSrc))}${row.end}\n`;
}

/** The region as `src` carries it (BEGIN..END lines), or null. */
export function extractRegion(row, src) {
  const b = src.indexOf(`${row.begin}\n`);
  if (b < 0) return null;
  const e = src.indexOf(`${row.end}\n`, b);
  return e < 0 ? null : src.slice(b, e + row.end.length + 1);
}

/** `src` with its region replaced by a fresh one from `ccdSrc`; throws when it carries no region. */
export function applyRegion(row, src, ccdSrc) {
  const old = extractRegion(row, src);
  if (old === null) throw new Error(`the file carries no generated ${row.label} region to regenerate`);
  return src.replace(old, () => renderRegion(row, ccdSrc));
}

/**
 * 'current' | 'missing' | 'edited' (stamp no longer matches the region's own
 * body) | 'stale' (stamp matches, but ccd or the constants have moved on).
 */
export function checkRegion(row, src, ccdSrc) {
  const region = extractRegion(row, src);
  if (region === null) return 'missing';
  const inner = region.slice(row.begin.length + 1, region.length - row.end.length - 1);
  if (verifyMarker(inner) !== 'ccrc-unmodified') return 'edited';
  return region === renderRegion(row, ccdSrc) ? 'current' : 'stale';
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
  if ((mode !== '--write' && mode !== '--check' && mode !== '--restamp') || !targetPath || !ccdPath) {
    process.stderr.write('usage: node shared/hook-helpers.mjs --write|--check|--restamp <target> <ccd> | --regions\n');
    process.exit(2);
  }
  const target = readFileSync(targetPath, 'utf8');
  const ccd = readFileSync(ccdPath, 'utf8');
  const row = regionOf(target);
  if (mode === '--restamp') {
    // One line for `ccrc restamp`: nothere | refused-missing | current | regenerated.
    let v;
    if (row === null) v = 'nothere';
    else if (extractRegion(row, target) === null) v = 'refused-missing';
    else if (checkRegion(row, target, ccd) === 'current') v = 'current';
    else {
      writeFileSync(targetPath, applyRegion(row, target, ccd));
      v = 'regenerated';
    }
    process.stdout.write(`${v}\n`);
  } else if (mode === '--write') {
    writeFileSync(targetPath, applyRegion(row ?? HOOK, target, ccd));
    process.stdout.write('hook-helpers: regenerated\n');
  } else {
    const v = checkRegion(row ?? HOOK, target, ccd);
    process.stdout.write(`hook-helpers: ${v}\n`);
    process.exit(v === 'current' ? 0 : 1);
  }
}
