// Whether a module was started as the program (not imported), for the test box's two programs: the service
// (`main.ts`) and the client (`client.ts`). The two paths are compared by REAL path, because the installed tree is
// reached through a link (`<tools>/release/installed`): node resolves the module's own URL through that link and
// leaves `argv[1]` as it was typed, so a comparison of the paths as written reads "imported" and the program does
// nothing and exits 0.
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** True iff `argv1` (the program path node was given) and `moduleUrl` (the module's `import.meta.url`) are one file. A path
 *  that cannot be resolved answers false: the module then behaves as imported. */
export function startedAsProgram(argv1: string | undefined, moduleUrl: string): boolean {
  if (argv1 === undefined) return false;
  try { return realpathSync(argv1) === realpathSync(fileURLToPath(moduleUrl)); } catch { return false; }
}
