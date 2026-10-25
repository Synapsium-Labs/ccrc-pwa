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
