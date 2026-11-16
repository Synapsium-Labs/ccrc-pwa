/**
 * D-6045 (Task C0l; ARCH-04 (#545), stage 1): the `node:*` modules a `.mjs` file may import, by where it sits.
 *
 * `MJS_CARVE_OUT` is ARCH-02a's `.mjs` carve-out (the 08-10 spec, L0; D-6000), copied here so the rule reads data,
 * and pinned to the spec's sentence by `mjs-node.test.ts`: a `shared/*.mjs` file, which the PWA never imports, may
 * import these and no other `node:*` module. A new module joins by an edit to that sentence, to CLAUDE.md's copy,
 * and to this set, in one PR.
 *
 * `REACHABLE_MJS_EXEMPTIONS` names, as `<file> -> <module>`, a builtin import in a `.mjs` file the PWA's bundle
 * reaches. Empty on the day the rule landed, and the aim is that it stays so: a builtin the bundle reaches breaks
 * the client build, and the carve-out never covers such a file.
 */
import type { EntrySet } from './exemptions.js';

export const MJS_CARVE_OUT: EntrySet = {
  'node:crypto': { reason: "ARCH-02a's carve-out: shared/mark.mjs hashes a marker's source", since: '2026-10-19' },
  'node:fs': { reason: "ARCH-02a's carve-out: shared/mark.mjs and shared/modelenv.mjs read and write their files", since: '2026-10-19' },
  'node:url': { reason: "ARCH-02a's carve-out: shared/mark.mjs finds its own path", since: '2026-10-19' },
};

export const REACHABLE_MJS_EXEMPTIONS: EntrySet = {};
