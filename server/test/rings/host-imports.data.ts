/**
 * D-6045, stage 2 (Task C0n; ARCH-04 (#545)): the files below L4 allowed to import `server.ts` or `watch.ts` in any
 * form, a type import included. Empty: ARCH-03 (#541, D-6003) declared every port such a file took from a host
 * beside its consumer, and `host-imports.test.ts` holds the set exactly. An entry is a debt with its reason and
 * date, never a carve-out.
 */
import type { EntrySet } from './exemptions.js';

export const HOST_IMPORT_EXEMPTIONS: EntrySet = {};
