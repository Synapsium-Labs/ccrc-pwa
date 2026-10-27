import { execFileSync } from 'node:child_process';

/** Git variables that would redirect a `git` call to some other repository. */
const REDIRECTING = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_NAMESPACE'];

const scrubbed = (): NodeJS.ProcessEnv => {
  const env = { ...process.env };
  for (const k of REDIRECTING) delete env[k];
  return env;
};

/** Whether `sha` names a commit this checkout holds (a shallow checkout may not). */
export const hasCommit = (repo: string, sha: string): boolean => {
  try {
    execFileSync('git', ['-C', repo, 'cat-file', '-e', `${sha}^{commit}`], { env: scrubbed(), stdio: 'ignore' });
    return true;
  } catch { return false; }
};

/** `rel`'s lines as they stood at commit `sha`, never the working tree; null when the commit has no such file. */
export const readAtSha = (repo: string, sha: string, rel: string): string[] | null => {
  try {
    return execFileSync('git', ['-C', repo, 'show', `${sha}:${rel}`],
      { env: scrubbed(), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }).split('\n');
  } catch { return null; }
};

/** Whether the checkout is shallow, the only reason a freeze commit may legitimately be absent. */
export const isShallow = (repo: string): boolean => {
  try {
    return execFileSync('git', ['-C', repo, 'rev-parse', '--is-shallow-repository'],
      { env: scrubbed(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() === 'true';
  } catch { return false; }
};

/** Whether `sha` is an ancestor of HEAD, so it survives a squash-merge and branch deletion. */
export const isAncestorOfHead = (repo: string, sha: string): boolean => {
  try {
    execFileSync('git', ['-C', repo, 'merge-base', '--is-ancestor', sha, 'HEAD'], { env: scrubbed(), stdio: 'ignore' });
    return true;
  } catch { return false; }
};
