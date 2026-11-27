// The shipped-tree copy and the installed launcher+body pair, shared by the entry tests (ccd-entry-install.test.ts
// owns the installer's behaviour; the launcher's own tests only need a working ~/.local/bin/ccd).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync, type SpawnSyncOptions, type SpawnSyncReturns } from 'node:child_process';
import { posixPath } from './helpers.js';
import { plantCore } from './coreBuild.js';
import { assertFencedEnv, fenceEnv } from './pathFence.js';
import { seedAccountsSh, CCD, CCD_LIB, CCD_TRAIN_LIB, CCD_LEASE_LIB, CCD_POOLSET_LIB, CCD_LONGLIVED_LIB, CCD_DOOR_LIB, CCD_ALIASES_LIB, CCD_REDACT, CCD_REDACT_CLI, CCD_DOOR_PROG, canonicalPython3 } from './ccdWsHelpers.js';

const REPO = path.resolve(__dirname, '..', '..');

/** A shipped-tree copy at `<home>/ccrc`: the body, the template and the helper.
 *  `template` rewrites the template's text (a hook, a broken self-test); `ccd`
 *  appends to the body; `installer` rewrites the helper's text (a fixture
 *  failure at a step no hook can reach); `lib` rewrites the library; `pin` rewrites the body's pin line (the committed one is
 *  the placeholder the installer renders, D-6913). */
export function plantEntryTree(home: string, o: {
  template?: (t: string) => string; ccd?: string; installer?: (t: string) => string; lib?: (t: string) => string; pin?: (line: string) => string;
  train?: (t: string) => string; trainPin?: (line: string) => string;
  lease?: (t: string) => string; leasePin?: (line: string) => string;
  poolset?: (t: string) => string; poolsetPin?: (line: string) => string;
  longlived?: (t: string) => string; longlivedPin?: (line: string) => string;
  door?: (t: string) => string; doorPin?: (line: string) => string;
  aliases?: (t: string) => string; aliasesPin?: (line: string) => string;
} = {}): void {
  const tree = path.join(home, 'ccrc');
  const dir = path.join(tree, 'ccd');
  fs.mkdirSync(path.join(dir, 'lib'), { recursive: true });
  const libText = o.lib ? o.lib(fs.readFileSync(CCD_LIB, 'utf8')) : fs.readFileSync(CCD_LIB, 'utf8');
  fs.writeFileSync(path.join(dir, 'lib', 'disk-retention.sh'), libText);
  // The second library (D-7463), `train` rewriting it as `lib` rewrites the first.
  const trainText = o.train ? o.train(fs.readFileSync(CCD_TRAIN_LIB, 'utf8')) : fs.readFileSync(CCD_TRAIN_LIB, 'utf8');
  fs.writeFileSync(path.join(dir, 'lib', 'train-proof.sh'), trainText);
  // The third library (wave 5), `lease` rewriting it as `train` rewrites the second.
  const leaseText = o.lease ? o.lease(fs.readFileSync(CCD_LEASE_LIB, 'utf8')) : fs.readFileSync(CCD_LEASE_LIB, 'utf8');
  fs.writeFileSync(path.join(dir, 'lib', 'delegation-lease.sh'), leaseText);
  // The fourth library (the Overlord's W1), `poolset` rewriting it as `lease` rewrites the third.
  const poolsetText = o.poolset ? o.poolset(fs.readFileSync(CCD_POOLSET_LIB, 'utf8')) : fs.readFileSync(CCD_POOLSET_LIB, 'utf8');
  fs.writeFileSync(path.join(dir, 'lib', 'pool-set.sh'), poolsetText);
  // The fifth library (the Overlord's ccd arms), `longlived` rewriting it as `poolset` rewrites the fourth.
  const longlivedText = o.longlived ? o.longlived(fs.readFileSync(CCD_LONGLIVED_LIB, 'utf8')) : fs.readFileSync(CCD_LONGLIVED_LIB, 'utf8');
  fs.writeFileSync(path.join(dir, 'lib', 'long-lived.sh'), longlivedText);
  // The sixth library (the Overlord's door process), `door` rewriting it as `longlived` rewrites the fifth.
  const doorText = o.door ? o.door(fs.readFileSync(CCD_DOOR_LIB, 'utf8')) : fs.readFileSync(CCD_DOOR_LIB, 'utf8');
  fs.writeFileSync(path.join(dir, 'lib', 'door.sh'), doorText);
  // The seventh library (the model-class Anthropic arm), `aliases` rewriting it as `door` rewrites the sixth.
  const aliasesText = o.aliases ? o.aliases(fs.readFileSync(CCD_ALIASES_LIB, 'utf8')) : fs.readFileSync(CCD_ALIASES_LIB, 'utf8');
  fs.writeFileSync(path.join(dir, 'lib', 'model-aliases.sh'), aliasesText);
  // The docs redactor's two files (D-7077), which the installer publishes beside the library and pins in the body.
  fs.mkdirSync(path.join(tree, 'shared'), { recursive: true });
  fs.copyFileSync(CCD_REDACT, path.join(tree, 'shared', 'redact.mjs'));
  fs.copyFileSync(CCD_REDACT_CLI, path.join(tree, 'shared', 'redact-cli.mjs'));
  // The door program, which the installer publishes beside the body and pins in it (`__CCD_DOOR_SHA256`).
  fs.copyFileSync(CCD_DOOR_PROG, path.join(dir, 'door-process.mjs'));
  // The Go core's table, and this platform's binary when an entry runs in go here (spec 2026-11-24): the installer
  // refuses a tree without the table.
  plantCore(tree);
  let bodyText = fs.readFileSync(CCD, 'utf8') + (o.ccd ?? '');
  if (o.pin) bodyText = bodyText.replace(/^__CCD_LIB_SHA256=.*$/m, o.pin);
  if (o.trainPin) bodyText = bodyText.replace(/^__CCD_LIB_TRAIN_SHA256=.*$/m, o.trainPin);
  if (o.leasePin) bodyText = bodyText.replace(/^__CCD_LIB_LEASE_SHA256=.*$/m, o.leasePin);
  if (o.poolsetPin) bodyText = bodyText.replace(/^__CCD_LIB_POOLSET_SHA256=.*$/m, o.poolsetPin);
  if (o.longlivedPin) bodyText = bodyText.replace(/^__CCD_LIB_LONGLIVED_SHA256=.*$/m, o.longlivedPin);
  if (o.doorPin) bodyText = bodyText.replace(/^__CCD_LIB_DOOR_SHA256=.*$/m, o.doorPin);
  if (o.aliasesPin) bodyText = bodyText.replace(/^__CCD_LIB_ALIASES_SHA256=.*$/m, o.aliasesPin);
  fs.writeFileSync(path.join(dir, 'ccd'), bodyText, { mode: 0o755 });
  const tpl = fs.readFileSync(path.join(REPO, 'ccd', 'ccd-entry.py'), 'utf8');
  fs.writeFileSync(path.join(dir, 'ccd-entry.py'), o.template ? o.template(tpl) : tpl);
  const inst = fs.readFileSync(path.join(REPO, 'ccd', 'ccd-entry-install.py'), 'utf8');
  fs.writeFileSync(path.join(dir, 'ccd-entry-install.py'), o.installer ? o.installer(inst) : inst);
}

/** The interpreter a spawn from node can start: the canonical `python3`, and on Windows its native `.exe` (a POSIX path
 *  such as `/usr/bin/python3` is not one node.exe can spawn). */
function entryPython(): string {
  const py = canonicalPython3();
  if (process.platform !== 'win32') return py;
  const w = spawnSync('cygpath', ['-w', py], { encoding: 'utf8' }).stdout.trim();
  return w.endsWith('.exe') ? w : w + '.exe';
}

/** Run the installed launcher. On Windows a shebang script is not executable from node, so the interpreter runs it. */
export function spawnEntry(entry: string, argv: string[], o: SpawnSyncOptions = {}): SpawnSyncReturns<string> {
  const run = process.platform === 'win32' ? [entryPython(), [posixPath(entry), ...argv]] as const : [entry, argv] as const;
  // The Windows fence (pathFence.ts), then its guard: a caller's raw spread of the worker's env never reaches the launcher.
  const env = fenceEnv(o.env ?? process.env);
  assertFencedEnv(env);
  return spawnSync(run[0], run[1], { encoding: 'utf8', ...o, env }) as SpawnSyncReturns<string>;
}

/** Plant the tree and run the installer into a fixture HOME: afterwards `<home>/.local/bin/ccd` works. */
export function installEntryFixture(home: string, o: Parameters<typeof plantEntryTree>[1] = {}): void {
  plantEntryTree(home, o);
  runEntryInstall(home);
}

/** Run the planted tree's installer into `<home>`, with `extra` beside HOME and PATH (the installer's test seam,
 *  CCRC_CORE_PLATFORM, among them). Throws when it does not exit 0. */
export function runEntryInstall(home: string, extra: NodeJS.ProcessEnv = {}): void {
  seedAccountsSh(home); // ccd dies without its roster
  // Windows: node.exe cannot spawn the POSIX path the interpreter reports, and MSYS2 python takes POSIX argv (it reads
  // `C:\...` as relative), so spawn its native twin and hand it `cygpath -u` paths. Elsewhere both helpers are identities.
  const exe = entryPython();
  const tree = path.join(home, 'ccrc');
  const env = fenceEnv({ HOME: home, PATH: process.env['PATH'] ?? '/usr/bin:/bin', ...extra });
  assertFencedEnv(env);
  const r = spawnSync(exe, ['-IS', posixPath(path.join(tree, 'ccd', 'ccd-entry-install.py')), 'install', posixPath(tree), posixPath(home)],
    { encoding: 'utf8', cwd: home, env });
  if (r.status !== 0) throw new Error(`entry install failed: ${r.error ?? ''}${r.stdout}${r.stderr}`);
}
