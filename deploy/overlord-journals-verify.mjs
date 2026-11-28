// overlord-journals-verify.mjs — do the Overlord's two chained journals verify? (Overlord W2, act journal plan Task A4,
// question 9; spec §7.6 H27, "Doctor verifies the chain".)
//
// RUN FROM THE INSTALLED TREE by `ccrc doctor`'s `overlord-journals` check: `node <tree>/deploy/overlord-journals-verify.mjs
// <ccrc dir>`. It imports the chained kernel's file adapter and both journals' formats from the server build that ships beside
// this file (`../server/dist/server/src/`, as `deploy/build-release.sh` stages them), so the chain it verifies is the one the
// server writes, by the server's own code: no second verifier. `--modules <dir>` points at another copy of those modules (a
// test's sources).
//
// READ ONLY. Each journal is read through the adapter's `read()`, which opens the file `O_RDONLY` and holds nothing after; this
// never appends, heals or cuts (the server heals a torn tail at its next boot). It prints ONE JSON LINE PER JOURNAL, in a fixed
// order, and nothing else on stdout:
//   {"journal":"authority"|"acts","state":"absent"}
//   {"journal":…,"state":"ok","sequence":<the head's sequence, 0 for a file of no record>}
//   {"journal":…,"state":"torn-tail","sequence":<the head before the tail>}
//   {"journal":…,"state":"malformed","code":"<the kernel's refusal word>"}
//   {"journal":…,"state":"unreadable","why":"<the adapter's word>"}
// IDS, WORDS AND COUNTS ONLY: no path, no record's content and no refusal's prose (which can quote a field), so a doctor line
// built from these never carries a record's text. A build it cannot load prints one line, {"state":"build-missing"}, and exits 3;
// doctor reads that, or no output at all, as unmeasured, never as a pass.
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
let modules = path.join(here, '..', 'server', 'dist', 'server', 'src');
const at = args.indexOf('--modules');
if (at !== -1) { modules = args[at + 1] ?? ''; args.splice(at, 2); }
const ccrcDir = args[0];
if (ccrcDir === undefined || ccrcDir === '' || modules === '') {
  process.stderr.write('usage: node overlord-journals-verify.mjs [--modules <dir>] <ccrc dir>\n');
  process.exit(2);
}

const load = (rel) => import(pathToFileURL(path.join(modules, rel)).href);
let fileAt, journals;
try {
  const [adapter, authority, acts] = await Promise.all([
    load('chainedJournalFile.js'), load('coord/overlordAuthority.js'), load('coord/overlordActRecords.js'),
  ]);
  fileAt = adapter.chainedJournalFileAt;
  journals = [
    ['authority', authority.OVERLORD_AUTHORITY_FORMAT, authority.OVERLORD_AUTHORITY_BASENAME],
    ['acts', acts.OVERLORD_ACTS_FORMAT, acts.OVERLORD_ACTS_BASENAME],
  ];
  if (typeof fileAt !== 'function' || journals.some(([, fmt, base]) => fmt === undefined || typeof base !== 'string')) throw new Error('exports');
} catch {
  process.stdout.write(`${JSON.stringify({ state: 'build-missing' })}\n`);
  process.exit(3);
}

const WORD = /^[a-z][a-z0-9-]{0,63}$/;
const word = (w) => (typeof w === 'string' && WORD.test(w) ? w : 'unknown');
for (const [journal, fmt, base] of journals) {
  let line;
  try {
    const r = fileAt(fmt, ccrcDir, base).read();
    const head = r.kind === 'records' ? (r.records.at(-1)?.sequence ?? 0) : 0;
    line = r.kind === 'absent' ? { journal, state: 'absent' }
      : r.kind === 'records' ? { journal, state: r.tail === null ? 'ok' : 'torn-tail', sequence: head }
        : r.kind === 'malformed' ? { journal, state: 'malformed', code: word(r.code) }
          : { journal, state: 'unreadable', why: word(r.why) };
  } catch {
    // A defect the adapter rethrows (never a refusal of the chain): unmeasured, named by no prose.
    line = { journal, state: 'unreadable', why: 'defect' };
  }
  process.stdout.write(`${JSON.stringify(line)}\n`);
}
