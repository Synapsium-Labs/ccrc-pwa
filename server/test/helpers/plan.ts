// D-8181: `plan(slug)` answers `required: true` for a slug with no `programs` row, so a route test that opens a run on a
// fresh database and a new slug is refused `plan-missing`. A test whose open is incidental seeds the programme as a pre-plan
// (legacy) one first: the same row `runs open` inserts, with `planRequired` 0 (a row that already exists, such as one a test
// opened at the store, is only marked), so the open is admitted as before.
import type { DatabaseSync } from 'node:sqlite';
import { isPositiveDecimalSafeInteger, programmeNameFromSlug, shapeProgramSlug } from '../../../shared/api.js';
import { shapeHomeProject } from '../../src/coord/openRun.js';

export function seedLegacyProgramme(db: DatabaseSync, slug: string, home: string): void {
  db.prepare(
    "INSERT INTO programs (slug, title, createdAt, state, homeProject, planRequired) VALUES (?, ?, ?, 'active', ?, 0) " +
    'ON CONFLICT(slug) DO UPDATE SET planRequired = 0',
  ).run(slug, programmeNameFromSlug(slug), Date.now(), home);
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
      if (body.kind !== 'review' && sane && slug?.ok === true && home?.ok === true) seedLegacyProgramme(db, slug.slug, home.home);
    }
    return inner(...a);
  };
  return app;
}
