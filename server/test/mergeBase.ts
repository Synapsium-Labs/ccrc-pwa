// The merge-base diff the added-lines rules share (citations.test.ts, refusal-status.test.ts):
// what a branch ADDS is measured against its merge-base with `origin/main`, not against a
// number, so a parallel PR's removal never moves this branch's baseline. Without
// `origin/main` (a shallow or detached checkout) the caller skips with a notice.
import { execFileSync } from 'node:child_process';

/** The unified-0 diff of `paths` (repo-relative) against the merge-base with `origin/main`
 *  in the checkout at `cwd`, or null when there is no `origin/main` or no merge-base. */
export function mergeBaseDiff(cwd: string, paths: readonly string[]): string | null {
  const git = (args: string[]): string =>
    execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe', maxBuffer: 64 * 1024 * 1024 });
  let base: string;
  try {
    git(['rev-parse', '--verify', '--quiet', 'origin/main^{commit}']);
    base = git(['merge-base', 'origin/main', 'HEAD']).trim();
  } catch {
    return null;
  }
  return git(['diff', '--unified=0', '--no-color', base, '--', ...paths]);
}

/** Per file (repo-relative path), the 1-based line numbers a unified-0 `diff` adds. */
export function addedLines(diff: string): Map<string, Set<number>> {
  const out = new Map<string, Set<number>>();
  let file = '';
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ ')) { file = line.startsWith('+++ b/') ? line.slice(6) : ''; continue; }
    const h = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (!h || !file) continue;
    const start = Number(h[1]); const count = h[2] === undefined ? 1 : Number(h[2]);
    const set = out.get(file) ?? new Set<number>();
    for (let n = start; n < start + count; n++) set.add(n);
    out.set(file, set);
  }
  return out;
}

/** Per file (repo-relative path on the BASE side), the 1-based line numbers a unified-0 `diff` removes. */
export function removedLines(diff: string): Map<string, Set<number>> {
  const out = new Map<string, Set<number>>();
  let file = '';
  for (const line of diff.split('\n')) {
    if (line.startsWith('--- ')) { file = line.startsWith('--- a/') ? line.slice(6) : ''; continue; }
    const h = /^@@ -(\d+)(?:,(\d+))? \+/.exec(line);
    if (!h || !file) continue;
    const start = Number(h[1]); const count = h[2] === undefined ? 1 : Number(h[2]);
    const set = out.get(file) ?? new Set<number>();
    for (let n = start; n < start + count; n++) set.add(n);
    out.set(file, set);
  }
  return out;
}

/** The text of `rel` (repo-relative) at the merge-base with `origin/main`, or null when it has none there. */
export function mergeBaseText(cwd: string, rel: string): string | null {
  try {
    const base = execFileSync('git', ['merge-base', 'origin/main', 'HEAD'], { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
    return execFileSync('git', ['show', `${base}:${rel}`], { cwd, encoding: 'utf8', stdio: 'pipe', maxBuffer: 64 * 1024 * 1024 });
  } catch {
    return null;
  }
}

/** One entry of a tree listing: the mode, the object type, the object id and the repo-relative path. */
export interface TreeEntry { readonly mode: string; readonly type: string; readonly oid: string; readonly path: string }

/** Every entry `rev`'s tree holds under `dir` (repo-relative, recursive), as `git ls-tree -r -z` lists them, or null when
 *  the listing cannot be read or a record does not parse: one record that is not `<mode> <type> <oid>\t<path>` makes the
 *  whole answer null, never a shorter list. */
export function treeEntriesAt(cwd: string, rev: string, dir: string): TreeEntry[] | null {
  let out: string;
  try {
    out = execFileSync('git', ['ls-tree', '-r', '-z', rev, '--', `${dir}/`], { cwd, encoding: 'utf8', stdio: 'pipe', maxBuffer: 64 * 1024 * 1024 });
  } catch {
    return null;
  }
  const entries: TreeEntry[] = [];
  for (const record of out.split('\0').filter(Boolean)) {
    const m = /^(\d{6}) (blob|commit|tree) ([0-9a-f]{40,64})\t([\s\S]+)$/.exec(record);
    if (m === null) return null;
    entries.push({ mode: m[1]!, type: m[2]!, oid: m[3]!, path: m[4]! });
  }
  return entries;
}

/** The merge-base with `origin/main` and every entry its tree holds under `dir` (repo-relative, recursive), with the
 *  paths of them as `files`, or null when there is no `origin/main`, no merge-base or no readable listing. */
export function mergeBaseFiles(cwd: string, dir: string): { base: string; files: string[]; entries: TreeEntry[] } | null {
  try {
    const base = execFileSync('git', ['merge-base', 'origin/main', 'HEAD'], { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
    const entries = treeEntriesAt(cwd, base, dir);
    if (entries === null) return null;
    return { base, files: entries.map((e) => e.path), entries };
  } catch {
    return null;
  }
}
