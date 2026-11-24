// Prints the next deviation numbers, measured on a ref (default origin/main) and HEAD together. No server, no allocator.
import { execFileSync } from 'node:child_process';
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

function main(argv: string[]): number {
  let count = 1;
  let ref = 'origin/main';
  const usage = (msg: string): number => {
    console.error(`next-deviation: ${msg}\nusage: next-deviation [count] [--ref <remote>/main]; run 'git fetch <remote> main' ` +
      'first (the project\'s remote: origin, or upstream when origin is your fork), or pass --ref');
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
    const opts = { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] } as const;
    const root = execFileSync('git', ['rev-parse', '--show-toplevel'], opts).trim();
    const sha = (r: string) => execFileSync('git', ['rev-parse', '--short', '--verify', `${r}^{commit}`], { ...opts, cwd: root }).trim();
    console.error(`measured ${ref} at ${sha(ref)} and HEAD at ${sha('HEAD')}`);
    // The union: a number the branch (or the branch under it) already took is not free, even before it merges.
    numbers = nextDeviationNumbers(
      definitionsIn([...readDefinitionFilesAt(root, ref), ...readDefinitionFilesAt(root, 'HEAD')]), count);
  } catch (e) {
    if (e instanceof RangeError) return usage(e.message);
    const stderr = (e as { stderr?: Buffer | string }).stderr?.toString().split('\n').find((l) => l.trim());
    return usage(`cannot measure ref '${ref}' (${stderr ?? (e as Error).message}): fetch it or pass --ref <ref>`);
  }
  for (const n of numbers) console.log('D-' + n);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
