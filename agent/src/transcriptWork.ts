// D-7898. L3 adapter: the walk that counts and sizes work kept inside Claude Code's transcript folders, every roster
// config dir's `projects/<slug>/...`. It measures and decides nothing (the level is `server/src/disk.ts`'s), and it never
// writes, moves or deletes: it reads directory listings and `lstat`s, and never follows a link.
//
// WHAT IS COUNTED. An entry of `projects/` that is not a directory, an entry of `projects/<slug>/` that is not one of
// the shapes Claude Code writes (`TRANSCRIPT_SHAPES`), and an entry of a session directory (`projects/<slug>/<uuid>/`)
// that is not one of the session shapes. Each counted entry is sized as `du -sb` sizes it (doctor's twin runs exactly
// that): the apparent bytes of every file and link under it, each inode once, a directory itself 0.
//
// BOUNDED, AND HONEST ABOUT IT. One deadline covers the whole walk (`TRANSCRIPT_WORK_DEADLINE_MS`), checked before every
// read and raced against a timer, so a read that never answers ends the walk too. A walk that ran out of time, or whose
// read failed anywhere (other than a config dir with no `projects/` at all, which holds nothing), is unmeasured as a
// whole: a partial count would read as a smaller, healthier number. The paths come from the roster on this box, never
// from a caller across the agent link.
import { lstat, readdir } from 'node:fs/promises';
import path from 'node:path';
import {
  isTranscriptShape, TRANSCRIPT_WORK_DEADLINE_MS, TRANSCRIPT_WORK_TOP,
  type TranscriptWorkEntry, type TranscriptWorkMeasured,
} from '../../shared/disk.js';

/** One entry as `lstat` reads it. */
export interface WalkStat { kind: 'file' | 'dir' | 'link' | 'other'; size: number; dev: number; ino: number }

/** Every read the walk makes, so a test injects the answer. The real ones are `realWalkSeams()`. */
export interface WalkSeams {
  /** A directory's entry names; throws on any failure (an absent directory is `code: 'ENOENT'`). */
  readdir(p: string): Promise<string[]>;
  lstat(p: string): Promise<WalkStat>;
  now(): number;
  /** The whole walk's bound. */
  deadlineMs: number;
}

const kindOf = (s: { isFile(): boolean; isDirectory(): boolean; isSymbolicLink(): boolean }): WalkStat['kind'] =>
  s.isSymbolicLink() ? 'link' : s.isDirectory() ? 'dir' : s.isFile() ? 'file' : 'other';

export function realWalkSeams(): WalkSeams {
  return {
    readdir: (p) => readdir(p),
    lstat: async (p) => {
      const s = await lstat(p);
      return { kind: kindOf(s), size: Number(s.size), dev: Number(s.dev), ino: Number(s.ino) };
    },
    now: () => Date.now(),
    deadlineMs: TRANSCRIPT_WORK_DEADLINE_MS,
  };
}

/** A roster config dir and the account it is named by (the first roster account naming it). */
export interface TranscriptRoot { account: string; dir: string }

class OutOfTime extends Error {}

const isEnoent = (e: unknown): boolean => (e as NodeJS.ErrnoException | null)?.code === 'ENOENT';

/** The largest first: bytes, then name. */
const byWeight = (a: TranscriptWorkEntry, b: TranscriptWorkEntry): number =>
  b.bytes - a.bytes || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

/** Walk every root once. Never throws: a fault is `measured: false`. */
export async function walkTranscriptWork(roots: readonly TranscriptRoot[], seams: WalkSeams): Promise<TranscriptWorkMeasured> {
  const started = seams.now();
  const deadlineAt = started + seams.deadlineMs;
  const guard = (): void => { if (seams.now() > deadlineAt) throw new OutOfTime(); };
  const ls = async (p: string): Promise<string[]> => { guard(); return (await seams.readdir(p)).sort(); };
  const st = async (p: string): Promise<WalkStat> => { guard(); return seams.lstat(p); };

  /** `du -sb <p>`: the apparent bytes of every non-directory under `p` (itself included), each inode once. */
  const sizeOf = async (p: string, s: WalkStat): Promise<number> => {
    const seen = new Set<string>();
    let total = 0;
    const visit = async (q: string, qs: WalkStat): Promise<void> => {
      if (qs.kind !== 'dir') {
        const id = `${qs.dev}:${qs.ino}`;
        if (!seen.has(id)) { seen.add(id); total += qs.size; }
        return;
      }
      for (const n of await ls(q)) {
        const c = path.join(q, n);
        await visit(c, await st(c));
      }
    };
    await visit(p, s);
    return total;
  };

  const found: TranscriptWorkEntry[] = [];
  const work = async (): Promise<void> => {
    for (const { account, dir } of roots) {
      const projects = path.join(dir, 'projects');
      let slugs: string[];
      try { slugs = await ls(projects); } catch (e) { if (isEnoent(e)) continue; throw e; }
      for (const slug of slugs) {
        const sp = path.join(projects, slug);
        const ss = await st(sp);
        if (ss.kind !== 'dir') { found.push({ name: `${account}/${slug}`, bytes: await sizeOf(sp, ss) }); continue; }
        for (const e of await ls(sp)) {
          const ep = path.join(sp, e);
          const es = await st(ep);
          if (!isTranscriptShape('slug', e, es.kind)) { found.push({ name: `${account}/${slug}/${e}`, bytes: await sizeOf(ep, es) }); continue; }
          if (es.kind !== 'dir' || e === 'memory') continue;
          // A session directory: its own entries are read in turn.
          for (const c of await ls(ep)) {
            const cp = path.join(ep, c);
            const cs = await st(cp);
            if (!isTranscriptShape('session', c, cs.kind)) found.push({ name: `${account}/${slug}/${e}/${c}`, bytes: await sizeOf(cp, cs) });
          }
        }
      }
    }
  };

  // The walk's own outcome is caught here, so a walk abandoned at the deadline that rejects later is never unhandled.
  const done = work().then((): 'done' => 'done', (e: unknown): 'timeout' | 'failed' => (e instanceof OutOfTime ? 'timeout' : 'failed'));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<'timeout'>((resolve) => { timer = setTimeout(() => resolve('timeout'), seams.deadlineMs + 50); });
  const r = await Promise.race([done, late]).finally(() => clearTimeout(timer));
  if (r !== 'done') return { measured: false, at: started, why: r };
  found.sort(byWeight);
  return {
    measured: true, at: started, entries: found.length, bytes: found.reduce((n, e) => n + e.bytes, 0),
    top: found.slice(0, TRANSCRIPT_WORK_TOP),
  };
}
