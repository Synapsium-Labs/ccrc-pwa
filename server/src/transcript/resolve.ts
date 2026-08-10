import path from 'node:path';
import type { FleetIO } from '../io.js';
import { mungePath } from '../munge.js';

/**
 * Transcript file for a session: `<configDir>/projects/<munge(dir)>/<uuid>.jsonl`.
 * Caller passes the live `cwd` when available, else the registry `workdir`.
 *
 * Pure and symlink-blind, deliberately: it munges the string it is given.
 * `resolveTranscriptFile` below is the seam-aware caller-facing resolver.
 */
export function transcriptPath(configDir: string, dir: string, uuid: string): string {
  return path.join(configDir, 'projects', mungePath(dir), `${uuid}.jsonl`);
}

/** `dir` with its longest existing prefix resolved to a physical path and the
 *  nonexistent tail re-attached — ccd's own `_ws_realpath` semantics, so the
 *  two implementations answer alike. Null when nothing resolves (an io with
 *  no resolver, i.e. remote mode). */
const resolveDir = async (io: FleetIO, dir: string): Promise<string | null> => {
  let head = dir;
  const tail: string[] = [];
  for (;;) {
    const real = await io.realpath(head);
    if (real !== null) return tail.length === 0 ? real : path.join(real, ...tail);
    const parent = path.dirname(head);
    if (parent === head) return null;
    tail.unshift(path.basename(head));
    head = parent;
  }
};

/**
 * The transcript path a reader should actually open. Claude Code munges its
 * PHYSICAL cwd (`process.cwd()` resolves symlinks) while the registry keeps
 * the path ccd wrote — on a box whose projects root is reached through
 * symlinks (`~/projects -> /data/projects -> /mnt/...`, this box) the two
 * munges disagree, and a DEAD session's chat looked under the registry munge,
 * rendered "Can't find this session's transcript", and reported "No messages
 * yet" over a transcript that existed the whole time. Live sessions never
 * showed it: their hooks hand over the physical cwd, which is why the defect
 * hid behind liveness.
 *
 * Preference order, and why it is existence-first:
 *   1. the RESOLVED munge when that file exists — the fix;
 *   2. the RAW munge when that file exists — every fixture and every session
 *      whose workdir has no symlink in it, i.e. today's behavior wherever
 *      today's behavior was right;
 *   3. the RAW munge when neither exists — a truly missing transcript reports
 *      the same path it always did, and a tailer pointed at it keeps working
 *      for a session that later writes there.
 * Remote mode has no resolver (io.realpath answers null) and lands in 2/3
 * unconditionally — unchanged behavior, stated rather than accidental.
 */
export async function resolveTranscriptFile(
  io: FleetIO, configDir: string, dir: string, uuid: string,
): Promise<string> {
  const raw = transcriptPath(configDir, dir, uuid);
  const resolved = await resolveDir(io, dir);
  if (resolved === null || resolved === dir) return raw;
  const real = transcriptPath(configDir, resolved, uuid);
  if (real === raw) return raw;
  if ((await io.stat(real)) !== null) return real;
  return raw;
}
