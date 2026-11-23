// Prints the next deviation numbers, measured on a ref (default origin/main). No server, no allocator.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { definitionsIn, nextDeviationNumbers } from '../src/coord/ledger.js';

export const DEFINITION_DIRS = ['docs/superpowers/plans/', 'docs/superpowers/programs/', 'docs/superpowers/specs/'] as const;

/** Every `.md` under the definition dirs at `ref`, with REPO-RELATIVE paths. */
export function readDefinitionFilesAt(root: string, ref: string): { path: string; text: string }[] {
  const git = (args: string[], max: number) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: max });
  const listing = git(['ls-tree', '-r', '--format=%(objectname) %(path)', ref, ...DEFINITION_DIRS], 1 << 24);
  const out: { path: string; text: string }[] = [];
  for (const line of listing.split('\n').filter(Boolean)) {
    const sp = line.indexOf(' ');
    const file = line.slice(sp + 1);
    if (!file.endsWith('.md')) continue;
    out.push({ path: file, text: git(['cat-file', 'blob', line.slice(0, sp)], 1 << 24) });
  }
  return out;
}

function main(argv: string[]): number {
  let count = 1;
  let ref = 'origin/main';
  const usage = (msg: string): number => {
    console.error(`next-deviation: ${msg}\nusage: next-deviation [count] [--ref <ref>]; run 'git fetch origin main' first, or pass --ref`);
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
    const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    const sha = execFileSync('git', ['rev-parse', '--short', '--verify', `${ref}^{commit}`], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    console.error(`measured ${ref} at ${sha}`);
    numbers = nextDeviationNumbers(definitionsIn(readDefinitionFilesAt(root, ref)), count);
  } catch (e) {
    if (e instanceof RangeError) return usage(e.message);
    return usage(`cannot measure ref '${ref}': run 'git fetch origin main' or pass --ref <ref>`);
  }
  for (const n of numbers) console.log('D-' + n);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
