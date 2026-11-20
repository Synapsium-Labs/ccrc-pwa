// A COPY of `deploy/models-op.mjs`, for the tests that run the op from a scratch directory: its imports pointed at this
// checkout's files, and, for the hold path of an Anthropic lane, its Anthropic arm with the hold gate open.
// The gate (`ANTHROPIC_HOLDS_APPLIED`, deploy/models-anthropic.mjs, D-8820) refuses `hold` and `revert` on an Anthropic
// lane until ccd applies a held id at launch (Task A3.4). The hold path behind it is kept whole, and its tests reach it
// through `holdsAppliedOp`, so the shipped op itself refuses while every rule of the path stays pinned.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const MODELS_OP = path.join(REPO, 'deploy', 'models-op.mjs');
export const ANTHROPIC_ARM = path.join(REPO, 'deploy', 'models-anthropic.mjs');

/** A copy's source with its imports pointed at this checkout: `../shared/` (the shared rules) and
 *  `./models-anthropic.mjs` (beside the op, so a copy elsewhere cannot find it) at `arm`. */
export const pointImports = (src: string, arm: string = ANTHROPIC_ARM): string => src
  .replaceAll("from '../shared/", `from '${pathToFileURL(path.join(REPO, 'shared')).href}/`)
  .replaceAll("from './models-anthropic.mjs'", `from '${pathToFileURL(arm).href}'`);

/** The gate's one line in the arm, and the line a copy puts in its place. */
export const HOLDS_GATE_LINE = 'export const ANTHROPIC_HOLDS_APPLIED = false;';
const HOLDS_OPEN_LINE = 'export const ANTHROPIC_HOLDS_APPLIED = true;';

/** Writes, into `dir`, a copy of the op whose Anthropic arm has the hold gate open, and answers the op copy's path.
 *  Throws when the arm does not carry the gate's line exactly once, so a moved or renamed gate is a red, never a copy
 *  that silently runs the shipped door. */
export function holdsAppliedOp(dir: string): string {
  const arm = readFileSync(ANTHROPIC_ARM, 'utf8');
  if (arm.split(HOLDS_GATE_LINE).length !== 2) throw new Error(`the arm does not carry the line ${HOLDS_GATE_LINE} once`);
  const armCopy = path.join(dir, 'models-anthropic-holds.mjs');
  const opCopy = path.join(dir, 'models-op-holds.mjs');
  writeFileSync(armCopy, pointImports(arm).replace(HOLDS_GATE_LINE, HOLDS_OPEN_LINE));
  writeFileSync(opCopy, pointImports(readFileSync(MODELS_OP, 'utf8'), armCopy));
  return opCopy;
}
