// The two artifacts a fixture BOX needs before `ccrc passwd` or doctor's `auth`
// check can do anything: the compiled reader, and the helper that imports it.
//
// ── WHY A REAL BUILD, AND NOT A STUB ──────────────────────────────────────
// `deploy/gen-auth-hash.mjs` imports `server/dist/server/src/auth/secret.js` —
// the module the SERVER boots on — precisely so the writer and the reader can
// never be two implementations of one format. A fixture that stubbed it would
// be testing the stub: the round trip this whole feature is built around
// (write a temp, read it back through the real parser, verify the passphrase
// against it, only then rename) is only worth anything against the real parser
// and its five parameter bounds.
//
// The build runs ONCE per test process (~0.7s with the repository's tsc) into a
// throwaway directory, so nothing here depends on whether the checkout happens
// to have `server/dist` lying around — which is a state a developer's tree is
// in or not, and a test that answered differently for the two would be a coin
// toss with an opinion.
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path, { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp } from './tmpHelpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..', '..');
const SERVER = join(REPO, 'server');

/** Where the compiled reader sits INSIDE a shipped tree, relative to its root.
 *  The `server/src` inside `dist/` is `server/tsconfig.json`'s `rootDir: ".."`
 *  showing through — `_inst_tree` preflights `server/dist/server/src/index.js`
 *  for the same reason, and `gen-auth-hash.mjs` resolves this exact path from
 *  its own location. */
export const SECRET_JS_IN_TREE = join('server', 'dist', 'server', 'src', 'auth', 'secret.js');

/** The scrypt parameters a planted module derives under. Mirrors
 *  `ScryptParams`; spelled here so a fixture can hand over a MUTANT set. */
export interface FixtureParams { n: number; r: number; p: number; keylen: number }

let built: string | undefined;

/** `server/src/auth/secret.ts`, compiled, at the path the real build puts it.
 *  Built on first use and reused for the rest of the process. */
export function compiledSecretJs(): string {
  if (built === undefined) {
    const out = mkTmp('ccrc-auth-dist-');
    // The repository's own compiler and the repository's own tsconfig (cwd), so
    // this is the build a deploy runs, not a hand-tuned approximation. A type
    // error makes `tsc` exit non-zero, which throws here — loudly, rather than
    // planting a module that silently did not compile.
    execFileSync(join(SERVER, 'node_modules', '.bin', 'tsc'), ['--outDir', out],
      { cwd: SERVER, stdio: 'pipe' });
    built = join(out, 'server', 'src', 'auth', 'secret.js');
  }
  return built;
}

/**
 * Plant the compiled reader in a fixture tree.
 *
 * `params` makes it a SENSITIVITY CONTROL rather than a copy: the real module
 * is planted beside the entry point and re-exported wholesale, with
 * `DEFAULT_PARAMS` — and nothing else — replaced. Every function the helper
 * calls (`readAuthSecret`, `hashLine`, `verifyPassphrase`) is the shipped one;
 * only the datum they are handed differs. That is what makes it possible to
 * measure the gap this feature exists to close — a parameter set `hashLine`
 * will happily derive under and `readAuthSecret` then refuses — without
 * shipping a broken default to prove it.
 */
export function plantAuthModule(tree: string, params?: FixtureParams): void {
  const dest = join(tree, SECRET_JS_IN_TREE);
  mkdirSync(dirname(dest), { recursive: true });
  if (params === undefined) {
    copyFileSync(compiledSecretJs(), dest);
    return;
  }
  copyFileSync(compiledSecretJs(), join(dirname(dest), 'secret.real.js'));
  // An explicit local export shadows a star re-export of the same name (it is
  // excluded from the star), so this module IS the real one with one constant
  // swapped.
  writeFileSync(dest,
    "export * from './secret.real.js';\n"
    + `export const DEFAULT_PARAMS = ${JSON.stringify(params)};\n`);
}

/** The passphrase {@link fixtureSecretLine}'s line verifies. Exported so a test
 *  that wants to prove the line is REAL — rather than plausible — can. */
export const FIXTURE_PASSPHRASE = 'fixture-box-passphrase';

let line: string | undefined;

/**
 * One real `auth.scrypt` line, produced ONCE per test process by the real
 * writer running under the real parameters — the file a real `ccrc passwd`
 * leaves behind, not a plausible-looking literal. A literal would be a second
 * copy of the format in a place nothing checks it, and the first parameter
 * bound it stopped satisfying would be a fixture nobody could explain.
 *
 * Reused across fixtures because it costs ~100ms of scrypt (that IS the
 * parameter set) and because nothing a doctor check measures depends on two
 * boxes having different salts.
 */
export function fixtureSecretLine(): string {
  if (line === undefined) {
    const dir = mkTmp('ccrc-auth-line-');
    const tree = join(dir, 'tree');
    plantAuthHelper(tree);
    plantAuthModule(tree);
    const file = join(dir, 'auth.scrypt');
    execFileSync(process.execPath, [join(tree, 'deploy', 'gen-auth-hash.mjs'), file],
      { input: FIXTURE_PASSPHRASE, stdio: ['pipe', 'pipe', 'pipe'] });
    line = readFileSync(file, 'utf8');
  }
  return line;
}

/** `deploy/gen-auth-hash.mjs`, COPIED rather than symlinked into the fixture
 *  tree. Not a style choice: node resolves a module's own imports relative to
 *  its REAL path, so a symlinked helper would import THIS CHECKOUT's
 *  `server/dist/…` — the module a fixture is trying to control — and every
 *  test here would silently measure the developer's tree instead of its own. */
export function plantAuthHelper(tree: string): void {
  const dest = join(tree, 'deploy', 'gen-auth-hash.mjs');
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(join(REPO, 'deploy', 'gen-auth-hash.mjs'), dest);
}
