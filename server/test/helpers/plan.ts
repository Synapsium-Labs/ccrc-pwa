// D-8181: `plan(slug)` answers `required: true` for a slug with no `programs` row, so a route test that opens a run on a
// fresh database and a new slug is refused `plan-missing`. A test whose open is incidental seeds the programme as a pre-plan
// (legacy) one first: the same row `runs open` inserts, with `planRequired` 0 (a row that already exists, such as one a test
// opened at the store, is only marked), so the open is admitted as before.
import type { DatabaseSync } from 'node:sqlite';
import { isPositiveDecimalSafeInteger, programmeNameFromSlug, shapeProgramSlug } from '../../../shared/api.js';
import { shapeHomeProject } from '../../src/coord/openRun.js';

//
// Programme lifecycle W1 (R11 rule 8, D-8993): a run never takes an existing programme that has no coordinator, so a seeded
// row names the coordinator the test's opens claim as (`coordinator`), as the first run's own mint would have bound it. It
// is bound only while that session owns no other programme (one programme per coordinator): otherwise the row is left
// unbound and the open is refused, as R11 refuses it.
export function seedLegacyProgramme(db: DatabaseSync, slug: string, home: string, coordinator?: string): void {
  const owns = coordinator === undefined ? undefined
    : db.prepare('SELECT 1 AS x FROM programs WHERE coordinator = ? AND slug != ?').get(coordinator, slug);
  const bind = coordinator !== undefined && owns === undefined ? coordinator : null;
  db.prepare(
    "INSERT INTO programs (slug, title, createdAt, state, homeProject, planRequired, coordinator) VALUES (?, ?, ?, 'active', ?, 0, ?) " +
    'ON CONFLICT(slug) DO UPDATE SET planRequired = 0, coordinator = COALESCE(programs.coordinator, excluded.coordinator)',
  ).run(slug, programmeNameFromSlug(slug), Date.now(), home, bind);
}

/** For a suite whose every open is incidental to its subject: wraps the app's `inject` so that a `POST /api/runs` of a work
 *  run whose slug and home shape first finds its programme seeded as a legacy one (above, with the home the body sends), as
 *  the suite did before `plan-missing`. A body the open route would refuse for its shape seeds nothing, so a refused open
 *  still leaves no programme row. */
export function legacyOpens<A extends { inject: (...a: never[]) => unknown }>(app: A, db: DatabaseSync): A {
  const inner = app.inject.bind(app) as (...a: unknown[]) => unknown;
  (app as { inject: unknown }).inject = (...a: unknown[]) => {
    const o = a[0] as { method?: string; url?: string; payload?: unknown } | undefined;
    const b = o?.payload;
    if (o !== undefined && o.method === 'POST' && o.url === '/api/runs' && typeof b === 'object' && b !== null) {
      const body = b as Record<string, unknown>;
      const slug = typeof body.program === 'string' ? shapeProgramSlug(body.program) : null;
      const home = typeof body.homeProject === 'string' ? shapeHomeProject(body.homeProject) : null;
      const sane = isPositiveDecimalSafeInteger(body.wave) && (body.waveOf === undefined || body.waveOf === null || isPositiveDecimalSafeInteger(body.waveOf));
      if (body.kind !== 'review' && sane && slug?.ok === true && home?.ok === true) {
        seedLegacyProgramme(db, slug.slug, home.home, typeof body.claimedBy === 'string' ? body.claimedBy : undefined);
      }
    }
    return inner(...a);
  };
  return app;
}
