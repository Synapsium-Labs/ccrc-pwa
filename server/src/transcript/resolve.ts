import path from 'node:path';
import { mungePath } from '../munge.js';

/**
 * Transcript file for a session: `<configDir>/projects/<munge(dir)>/<uuid>.jsonl`.
 * Caller passes the live `cwd` when available, else the registry `workdir`.
 */
export function transcriptPath(configDir: string, dir: string, uuid: string): string {
  return path.join(configDir, 'projects', mungePath(dir), `${uuid}.jsonl`);
}
