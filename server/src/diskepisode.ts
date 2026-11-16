// D-6616 (spec docs/superpowers/specs/2026-10-23-fleet-disk-retention-design.md §2.5; plan Task DR-4). L3: the disk
// alarm's open-episode mark, one small file in the ccrc dir. The decider (`disk.ts`) is pure; this is the one place
// the mark touches a disk, so `watch.ts` (L4) holds no write. A latch that forgets on restart repeats the push (the
// `pushRelease` rule), so a process that meets a standing `warn`/`critical` with no memory resumes the marked episode.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

function episodePath(ccrcDir: string): string { return path.join(ccrcDir, 'disk-episode'); }

/** The marked episode and the dev(s) of the filesystem(s) whose rise pushed it, or null when none is marked or the mark
 *  is unreadable. A mark written before devs were recorded reads with none, which `diskMarkFate` calls stale. */
export function readDiskEpisode(ccrcDir: string): { episode: number; devs: string[] } | null {
  try {
    const [head, list] = readFileSync(episodePath(ccrcDir), 'utf8').trim().split(/\s+/);
    const episode = Number(head);
    if (!Number.isFinite(episode) || episode <= 0) return null;
    return { episode, devs: list === undefined ? [] : list.split(',') };
  } catch { return null; }
}

/** Marks `dev` as a filesystem whose rise pushed `episode`: the devs of the same episode accumulate, a mark of another
 *  episode is replaced. A mark that cannot be written costs the restart dedupe only, never the notice. */
export function writeDiskEpisode(ccrcDir: string, episode: number, dev: string): void {
  try {
    mkdirSync(ccrcDir, { recursive: true });
    const held = readDiskEpisode(ccrcDir);
    const devs = held?.episode === episode ? [...new Set([...held.devs, dev])] : [dev];
    writeFileSync(episodePath(ccrcDir), `${episode} ${devs.join(',')}\n`);
  } catch { /* the notice still goes out */ }
}

/** A clear to `ok` forgets the mark. */
export function clearDiskEpisode(ccrcDir: string): void {
  try { rmSync(episodePath(ccrcDir), { force: true }); } catch { /* nothing to forget */ }
}
