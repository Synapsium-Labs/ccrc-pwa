// Landing order wave 5f: the narrow fixture helper the landing fixtures share. A temporary configured journal inside the
// fixture's own directory (the database's parent, never the live HOME) and the boot replay that opens the store's landing
// entrances, exactly as `index.ts` does. A fixture that wants a store WITHOUT a port builds `new CoordStore(db)` itself.
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { LandingControlRead } from '../src/coord/radar.js';
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

// ---- wave 5i: the control bundle the binding head is decided from ----------------------------------------------------
// Neutral full SHAs and explicit producer timestamps; `CONTROL_NOW` is the tests' fixed clock, passed to parsers and
// deciders, never read globally. A test perturbs one document through `over`, a shallow merge on the three reads.
export const CONTROL_NOW = Date.parse('2026-11-14T12:00:00Z');
const controlIso = (offsetMs: number): string => new Date(CONTROL_NOW + offsetMs).toISOString().replace(/\.\d{3}Z$/, 'Z');
export const CONTROL_BASE_SHA = 'a'.repeat(40);
export const CONTROL_HEAD_SHA = 'b'.repeat(40);

/** The baseline bundle: marker two seconds before the probe's, probe one second before now, health at now, all `project-a`. */
export function controlRead(over: Partial<LandingControlRead> = {}): LandingControlRead {
  return {
    lander: { ok: true, doc: { project: 'project-a', lander: 'coordinator', at: controlIso(-2000) } },
    probe: {
      ok: true,
      doc: {
        project: 'project-a', at: controlIso(-1000), baseRef: 'main', baseSha: CONTROL_BASE_SHA,
        heads: [{ pr: 7, head: CONTROL_HEAD_SHA, branch: 'ws/alpha', id: 'lane-a-project-a-alpha', base: { state: 'clean' } }],
        headsCut: false, pairs: [], pairHeads: [], pairsCut: false,
      },
    },
    health: {
      ok: true,
      doc: {
        project: 'project-a', at: controlIso(0), sha: CONTROL_BASE_SHA, state: 'green',
        required: [{ name: 'required-a', app: null }], failing: [], pending: [],
      },
    },
    ...over,
  };
}
