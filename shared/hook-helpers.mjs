// ARCH-74 (#809), K18: the session hook's helpers that are byte-identical to
// ccd's are GENERATED into the hook, not hand-copied. The hook is installed
// alone into the session registry and sources nothing, so it cannot call
// ccd's `_plat_epoch_ms`; it carries a copy, and this module is the one
// writer of that copy.
//
// What is generated, and from where:
//   - `_hook_epoch_ms`, from the body of `_plat_epoch_ms` in `ccd/ccd`'s
//     platform block (the name differs, the body may not);
//   - `CCRC_PROJ_CLASS`, `CCRC_PROJ_MAX` and `CCRC_ID_MAX`, from the
//     constants below, which are their one definition.
// Nothing else is: the hook's compaction-lock region differs from ccd's on
// purpose (its own exit-0 contract and rc-2 arms), so it stays hand-written.
//
// The copy sits between a BEGIN and an END line in the hook and carries the
// same `# ccrc:generated 1 sha256=…` stamp `shared/mark.mjs` writes for
// `ccd/ccd`, over the region's own body, so the stamp tells a regenerated
// region from a hand-edited one. Regenerate with
//   ccrc restamp ccd/session-hook.sh
// (the one regeneration verb; it calls this module with the tree's own ccd).
// The `--write` / `--check` CLI below is the engine's entry, used by tests. A pure byte copy, not a
// `source`: a runtime-sourced sibling is refused by the architecture spec.
//
// Plain ESM with no npm imports, like `shared/mark.mjs`, so `deploy/` and the
// tests can run it with a bare `node`.

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

/** The body of ccd's `_plat_epoch_ms`, or null when ccd has no such function. */
export function ccdEpochBody(ccdSrc) {
  const m = /^_plat_epoch_ms\(\) \{[^\n]*\n([\s\S]*?)\n\}$/m.exec(ccdSrc);
  return m ? m[1] : null;
}

/** The region's body (unstamped): the helper and the constants. */
export function renderHookBody(ccdSrc) {
  const body = ccdEpochBody(ccdSrc);
  if (body === null) throw new Error('ccd has no _plat_epoch_ms to generate _hook_epoch_ms from');
  const consts = Object.entries(HOOK_CONSTANTS).map(([k, v]) => (typeof v === 'string' ? `${k}='${v}'` : `${k}=${v}`));
  return `_hook_epoch_ms() {\n${body}\n}\n${consts.join('\n')}\n`;
}

/** The whole stamped region, BEGIN and END lines included, ending in a newline. */
export function renderHookRegion(ccdSrc) {
  return `${HOOK_REGION_BEGIN}\n${markGenerated(renderHookBody(ccdSrc))}${HOOK_REGION_END}\n`;
}

/** The region as the hook carries it (BEGIN..END lines), or null. */
export function extractHookRegion(hookSrc) {
  const b = hookSrc.indexOf(`${HOOK_REGION_BEGIN}\n`);
  if (b < 0) return null;
  const e = hookSrc.indexOf(`${HOOK_REGION_END}\n`, b);
  return e < 0 ? null : hookSrc.slice(b, e + HOOK_REGION_END.length + 1);
}

/** `hookSrc` with its region replaced by a fresh one from `ccdSrc`; throws when the hook has no region. */
export function applyHookRegion(hookSrc, ccdSrc) {
  const old = extractHookRegion(hookSrc);
  if (old === null) throw new Error('the hook carries no generated-helpers region to regenerate');
  return hookSrc.replace(old, () => renderHookRegion(ccdSrc));
}

/**
 * 'current' | 'missing' | 'edited' (stamp no longer matches the region's own
 * body) | 'stale' (stamp matches, but ccd or the constants have moved on).
 */
export function checkHookRegion(hookSrc, ccdSrc) {
  const region = extractHookRegion(hookSrc);
  if (region === null) return 'missing';
  const inner = region.slice(HOOK_REGION_BEGIN.length + 1, region.length - HOOK_REGION_END.length - 1);
  if (verifyMarker(inner) !== 'ccrc-unmodified') return 'edited';
  return region === renderHookRegion(ccdSrc) ? 'current' : 'stale';
}

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
  const [mode, hookPath, ccdPath] = process.argv.slice(2);
  if ((mode !== '--write' && mode !== '--check') || !hookPath || !ccdPath) {
    process.stderr.write('usage: node shared/hook-helpers.mjs --write|--check <session-hook.sh> <ccd>\n');
    process.exit(2);
  }
  const hook = readFileSync(hookPath, 'utf8');
  const ccd = readFileSync(ccdPath, 'utf8');
  if (mode === '--write') {
    writeFileSync(hookPath, applyHookRegion(hook, ccd));
    process.stdout.write('hook-helpers: regenerated\n');
  } else {
    const v = checkHookRegion(hook, ccd);
    process.stdout.write(`hook-helpers: ${v}\n`);
    process.exit(v === 'current' ? 0 : 1);
  }
}
