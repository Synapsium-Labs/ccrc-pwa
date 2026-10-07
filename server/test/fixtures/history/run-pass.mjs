// server/test/fixtures/history/run-pass.mjs — TEST-ONLY. Runs ccd/history/sweep.mjs's runPass in this
// process with injected dependencies: spec 2026-10-05 §10.1 "Seams", "L3 and L4 faults in a spawned
// process are injected ... by in-process imports with injected dependencies". sweep.mjs itself reads no
// seam (D-4247, slug history-test-seams-not-env): this file is the ONLY reader of HISTORY_TEST_DEPS, and it is
// never shipped (server/test lies outside the release PATHSPEC, deploy/build-release.sh:103-106).
//
// HISTORY_TEST_DEPS is one JSON object:
//   offsetMs, stepMs   the pass clock: Date.now() + offsetMs + k * stepMs on its k-th read (k from 0)
//   sizeBytes          the store's measured size, whatever the file holds (the cap's seam, O10)
//   extraMigrations    SQL appended to MIGRATIONS as v2, v3, ... (the migration seam, DM42/DM43)
//   heavy              the versions among those that SCHEMA_ADDED marks heavy
//   managedSettings    the managed-settings list the census reads instead of /etc (Task 26)
// argv after the script is runPass's argv, exactly as the shim would pass it.
import { runPass } from '../../../../ccd/history/sweep.mjs';
import { MIGRATIONS } from '../../../../ccd/history/store.mjs';
import { SCHEMA_ADDED } from '../../../../ccd/history/lib.mjs';

const spec = JSON.parse(process.env.HISTORY_TEST_DEPS ?? '{}');
const deps = {};
if (spec.offsetMs !== undefined || spec.stepMs !== undefined) {
  let k = 0;
  deps.now = () => Date.now() + (spec.offsetMs ?? 0) + (k++) * (spec.stepMs ?? 0);
}
if (Array.isArray(spec.extraMigrations) && spec.extraMigrations.length > 0) {
  deps.migrations = [...MIGRATIONS, ...spec.extraMigrations];
  const added = { ...SCHEMA_ADDED };
  let prev = SCHEMA_ADDED[MIGRATIONS.length].tables;
  spec.extraMigrations.forEach((_, i) => {
    const v = MIGRATIONS.length + i + 1;
    const tables = { ...prev, [`seam_v${v}`]: ['x'] };   // additive, as every real migration must be
    added[v] = { heavy: (spec.heavy ?? []).includes(v), tables };
    prev = tables;
  });
  deps.schemaAdded = added;
}
if (typeof spec.sizeBytes === 'number') deps.measureSize = () => spec.sizeBytes;
if (Array.isArray(spec.managedSettings)) deps.managedSettings = spec.managedSettings;
const code = await runPass(process.argv.slice(2), deps);
// An explicit exit, never a drained loop: an unsettled statfs (the 'hang' seam) pins a libuv thread.
process.stdout.write('', () => process.exit(code));
