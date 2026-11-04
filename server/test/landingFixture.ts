// Landing order wave 5f: the narrow fixture helper the landing fixtures share. A temporary configured journal inside the
// fixture's own directory (the database's parent, never the live HOME) and the boot replay that opens the store's landing
// entrances, exactly as `index.ts` does. A fixture that wants a store WITHOUT a port builds `new CoordStore(db)` itself.
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { createLandingJournal } from '../src/coord/landingJournal.js';
import type { LandingMutationFacts } from '../src/coord/landingWrites.js';
import { CoordStore } from '../src/coord/store.js';

/** A store over `db` whose journal lives in `db`'s directory, boot-replayed (refuses the fixture when the replay does). */
export function landingStoreOver(db: DatabaseSync, dbPath: string): CoordStore {
  const store = new CoordStore(db, { landingJournal: createLandingJournal(path.dirname(dbPath)) });
  const replay = store.replayLandingJournal();
  if (!replay.ok) throw new Error(`fixture landing replay refused: ${replay.error}`);
  return store;
}

/** The guarded facts of one project, or a thrown fixture error. */
export function landingFactsOf(store: CoordStore, project: string): LandingMutationFacts {
  const read = store.readLanding(project);
  if (!read.ok) throw new Error(`fixture landing read refused: ${read.error}`);
  return read.facts;
}
