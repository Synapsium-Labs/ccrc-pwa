// D-8406: a lane's class registry and catalogue (`registryFileName`, `catalogueFileName` under `~/.ccrc/models`), as
// the session's model picker reads them through `GET /api/models/:lane`. Ring L3, context C1 (Fleet Registry &
// Accounts): it reads the two files through the fleet's own `read` op (`FleetIO.readFileMeasured`; the agent admits
// exactly these two names, `isLaneModelsReadName`) and hands every judgement to the models kernel (`parseRegistry`,
// `parseCatalogue`, `laneClassModels`, `shared/models.mjs`), which is what `ccrc models <lane> show` runs on the fleet
// box. The registry stays the one owner of which model a class maps to, and the catalogue of what that model is called:
// nothing here names a model.
//
// The two non-readings stay two (`LaneModelsRead`): an absent registry is `absent`, and one that exists and cannot be
// read or parsed (or a fleet that refuses the read, as an agent from before this grant does) is `unreadable`. A
// catalogue that is absent or unreadable costs only the labels: each class keeps its model, with `label: null`. Never
// rejects.
import path from 'node:path';
import {
  MODELS_DIR_NAME, catalogueFileName, laneClassModels, parseCatalogue, parseRegistry, registryFileName,
  type Catalogue, type LaneModelsRead, type Registry,
} from '../../shared/models.js';
import type { FleetIO } from './io.js';

export async function readLaneModels(io: FleetIO, ccrcDir: string, lane: string): Promise<LaneModelsRead> {
  const dir = path.join(ccrcDir, MODELS_DIR_NAME);
  const [reg, cat] = await Promise.all([
    io.readFileMeasured(path.join(dir, registryFileName(lane))),
    io.readFileMeasured(path.join(dir, catalogueFileName(lane))),
  ]);
  if (!reg.ok) return { kind: reg.reason === 'absent' ? 'absent' : 'unreadable' };
  let registry: Registry;
  // No catalogue handed to `parseRegistry`: with one, an effort level the classed model does not list refuses the
  // whole file, and a label read must not fail for an effort fact (the parser's own header says the same).
  try { registry = parseRegistry(JSON.parse(reg.content)); } catch { return { kind: 'unreadable' }; }
  let catalogue: Catalogue | null = null;
  if (cat.ok) {
    try { catalogue = parseCatalogue(JSON.parse(cat.content)); } catch { catalogue = null; }
  }
  return { kind: 'read', classes: laneClassModels(registry, catalogue) };
}
