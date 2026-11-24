// Prints the next deviation numbers, measured on a base ref (resolveLedgerBase) and HEAD together. No server, no allocator.
import { execFileSync, type ExecFileSyncOptionsWithStringEncoding } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { definitionsIn, nextDeviationNumbers } from '../src/coord/ledger.js';

export const DEFINITION_DIRS = ['docs/superpowers/plans/', 'docs/superpowers/programs/', 'docs/superpowers/specs/'] as const;

/** Every `.md` under `dirs` at `ref`, with REPO-RELATIVE paths: one `ls-tree` and one `cat-file --batch`. */
export function readDefinitionFilesAt(
  root: string, ref: string, dirs: readonly string[] = DEFINITION_DIRS,
): { path: string; text: string }[] {
  const listing = execFileSync('git', ['ls-tree', '-r', '-z', ref, '--', ...dirs],
    { cwd: root, encoding: 'utf8', maxBuffer: 1 << 24, stdio: ['ignore', 'pipe', 'pipe'] });
  const blobs: { sha: string; path: string }[] = [];
  for (const rec of listing.split('\0')) {
    const tab = rec.indexOf('\t');
    if (tab < 0) continue;
    const [, type, sha] = rec.slice(0, tab).split(' ');
    const file = rec.slice(tab + 1);
    if (type === 'blob' && file.endsWith('.md')) blobs.push({ sha: sha!, path: file });
  }
  if (blobs.length === 0) return [];
  const out = execFileSync('git', ['cat-file', '--batch'],
    { cwd: root, input: blobs.map((b) => b.sha).join('\n') + '\n', maxBuffer: 1 << 28, stdio: ['pipe', 'pipe', 'pipe'] });
  // Framing: `<sha> blob <size>\n<size bytes>\n` per object, in input order.
  let at = 0;
  return blobs.map((b) => {
    const nl = out.indexOf(0x0a, at);
    const header = out.toString('utf8', at, nl).split(' ');
    if (header[1] !== 'blob') throw new Error(`git cat-file --batch: unexpected '${header.join(' ')}' for ${b.path}`);
    const size = Number(header[2]);
    const text = out.toString('utf8', nl + 1, nl + 1 + size);
    at = nl + 1 + size + 1;
    return { path: b.path, text };
  });
}

/**
 * The base the helper and the collision guard (`deviation-refs.test.ts`) both measure: `envRef`
 * (`$CCRC_LEDGER_BASE`) when it resolves, then `upstream/main` (a fork's project remote), then
 * `origin/main`; else null. No further fallback (the fossil note in `deviation-refs.test.ts`):
 * local `main` was a fossil on the fleet host, and a silent fossil is worse than "I could not measure".
 */
export function resolveLedgerBase(
  root: string, envRef: string | undefined = process.env['CCRC_LEDGER_BASE'],
): string | null {
  for (const ref of [envRef, 'upstream/main', 'origin/main']) {
    if (!ref) continue;
    try {
      execFileSync('git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { cwd: root, stdio: 'pipe' });
      return ref;
    } catch { /* try the next candidate */ }
  }
  return null;
}

/**
 * The definition paths the branch changed since its merge base with `base`, renames off: a path deleted or
 * renamed away is listed, so the collision guard reads it as absent rather than from the base. The three-dot
 * diff never lists main's own later additions.
 */
export function changedDefinitionPaths(root: string, base: string, dirs: readonly string[] = DEFINITION_DIRS): Set<string> {
  return new Set(execFileSync('git', ['diff', '--name-only', '--no-renames', '-z', `${base}...HEAD`, '--', ...dirs],
    { cwd: root, encoding: 'utf8', maxBuffer: 1 << 24 }).split('\0').filter(Boolean));
}

/**
 * Whether `base` (an explicit `$CCRC_LEDGER_BASE`) is behind what the resolver picks without it: null when
 * nothing else resolves, the two are the same ref, or that ref is an ancestor of `base`. Measured against the
 * resolver's own answer, never a hard-coded `origin/main`, so a fork whose `main` diverged from upstream is not
 * stale. Residual: a transient failure to resolve `upstream/main` (D-2732's `packed-refs` case) drops a fork to its
 * `origin/main` here too; both tools print the base they measured.
 */
export function staleLedgerBase(root: string, base: string): { anchor: string; behind: number } | null {
  const anchor = resolveLedgerBase(root, '');
  if (anchor === null || anchor === base) return null;
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', anchor, base], { cwd: root, stdio: 'pipe' });
    return null;
  } catch {
    const behind = Number(execFileSync('git', ['rev-list', '--count', `${base}..${anchor}`], { cwd: root, encoding: 'utf8' }).trim());
    return { anchor, behind };
  }
}

function main(argv: string[]): number {
  let count = 1;
  let ref: string | null = null;
  const usage = (msg: string): number => {
    console.error(`next-deviation: ${msg}\nusage: next-deviation [count] [--ref <ref>]; run 'git fetch origin main' ` +
      '(or \'git fetch upstream main\' on a fork) first: the base is $CCRC_LEDGER_BASE, else upstream/main, else origin/main');
    return 2;
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--ref') {
      const v = argv[++i];
      if (!v) return usage('--ref needs a value');
      ref = v;
    } else if (/^\d+$/.test(argv[i]!)) count = Number(argv[i]);
    else return usage(`bad argument ${argv[i]}`);
  }
  let numbers: number[];
  try {
    const opts: ExecFileSyncOptionsWithStringEncoding = { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] };
    const root = execFileSync('git', ['rev-parse', '--show-toplevel'], opts).trim();
    ref ??= resolveLedgerBase(root);
    if (ref === null) return usage('no base resolved: fetch origin main, or upstream main on a fork, or pass --ref');
    const sha = (r: string) => execFileSync('git', ['rev-parse', '--short', '--verify', `${r}^{commit}`], { ...opts, cwd: root }).trim();
    console.error(`measured ${ref} at ${sha(ref)} and HEAD at ${sha('HEAD')}`);
    // The union: a number the branch (or the branch under it) already took is not free, even before it merges.
    numbers = nextDeviationNumbers(
      definitionsIn([...readDefinitionFilesAt(root, ref), ...readDefinitionFilesAt(root, 'HEAD')]), count);
  } catch (e) {
    if (e instanceof RangeError) return usage(e.message);
    const stderr = (e as { stderr?: Buffer | string }).stderr?.toString().split('\n').find((l) => l.trim());
    return usage(`cannot measure ref '${ref ?? 'the base'}' (${stderr ?? (e as Error).message}): fetch it or pass --ref <ref>`);
  }
  for (const n of numbers) console.log('D-' + n);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
