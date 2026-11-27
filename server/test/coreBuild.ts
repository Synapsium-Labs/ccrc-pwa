// Builds ccrc-core once per test process (spec 2026-11-24 §6), and plants the core into a fixture tree as a release
// carries it. No vitest import (Node's modules and the server's exec.ts only), so installTreeFixture.ts (vitest-free by
// contract) may import it; the body copy a parity run needs beside the binary is ccdTwin.ts's.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveBash } from '../src/exec.js';

const CORE = path.resolve(__dirname, '../../core');
let built: string | undefined;

/** This test process's platform and architecture as Go names them, and the binary's name there. */
export const CORE_GOOS = ({ win32: 'windows', linux: 'linux', darwin: 'darwin' } as Record<string, string>)[process.platform]!;
export const CORE_GOARCH = ({ x64: 'amd64', arm64: 'arm64' } as Record<string, string>)[process.arch]!;
export const coreExe = (goos = CORE_GOOS): string => (goos === 'windows' ? 'ccrc-core.exe' : 'ccrc-core');

/** Every entry of `core/entries.json` in go mode on `goos`, sorted, the hook row included: what needs the binary. */
export function coreGoEntries(goos = CORE_GOOS): string[] {
  const t = JSON.parse(fs.readFileSync(path.join(CORE, 'entries.json'), 'utf8')) as
    { entries: Record<string, { mode?: Record<string, string> }> };
  return Object.keys(t.entries).filter((v) => t.entries[v]!.mode?.[goos] === 'go').sort();
}

/** The verbs among them, which is what the installer renders into the launcher's `verbs`: the `hook` row is a mode, never
 *  a verb (`kernel.HookEntry`), so it is not routed and `ccd caps` lists no go:hook. */
export function coreGoVerbs(goos = CORE_GOOS): string[] {
  return coreGoEntries(goos).filter((v) => v !== 'hook');
}

/** The environment Go builds under. On Windows Go finds its cache and module root through %LocalAppData% and
 *  %USERPROFILE%; a vitest started under an MSYS2 program from Git Bash (MSYS2's `timeout`, measured) inherits neither,
 *  and `go build` refuses ("GOCACHE is not defined and %LocalAppData% is not defined"). So an unset GOCACHE or GOPATH
 *  is named here as the Windows path Go would have chosen itself; a set one is kept. */
export function goBuildEnv(env: NodeJS.ProcessEnv = process.env, platform: string = process.platform): NodeJS.ProcessEnv {
  if (platform !== 'win32') return env;
  const local = env.LOCALAPPDATA || path.win32.join(os.homedir(), 'AppData', 'Local');
  return { ...env, GOCACHE: env.GOCACHE || path.win32.join(local, 'go-build'),
    GOPATH: env.GOPATH || path.win32.join(env.USERPROFILE || os.homedir(), 'go') };
}

/** `<dir>/core/ccrc-core[.exe]`, built once per test process. */
export function coreBinary(): string {
  if (built) return built;
  // Not mkTmp: that removes its directories after each FILE, and this build is cached for the whole process.
  // os.tmpdir() is the run's own ccrc-testrun-* parent (run-tmp.globalsetup.mjs), removed with the run.
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ccrc-core-')));
  // Through core/build.sh, the one build command, so the tests run a binary built with the flags a release ships. It
  // writes <dir>/core/<goos>-<goarch>/; the binary moves up to <dir>/core/, the installed layout (../ccd beside it).
  const target = `${CORE_GOOS}-${CORE_GOARCH}`;
  const out = path.join(dir, 'core');
  try {
    execFileSync(resolveBash(), [path.join(CORE, 'build.sh').replace(/\\/g, '/'), out.replace(/\\/g, '/'), target],
      { stdio: ['ignore', 'ignore', 'pipe'], env: goBuildEnv() });
  } catch (e) {
    throw new Error(`ccrc-core could not be built (is Go 1.27 on PATH?): ${String((e as { stderr?: Buffer }).stderr ?? e)}`);
  }
  const exe = path.join(out, coreExe());
  fs.renameSync(path.join(out, target, coreExe()), exe);
  fs.rmdirSync(path.join(out, target));
  // The hook's library beside it, where the Go hook looks first, as the bash looks in its own directory's lib/ first
  // (ROSTER_CARD_LIB): an installed core has none there and both read ~/.cc-sessions/lib.
  fs.cpSync(path.resolve(CORE, '../ccd/lib'), path.join(out, 'lib'), { recursive: true });
  return (built = exe);
}

/** A release tree's core under `<tree>/core`: the entry table, and this platform's binary at `bin/<goos>-<goarch>/`
 *  only when an entry is in go mode here, as the installer reads it (no go verb, no binary read; and no Go build
 *  where none is needed). */
export function plantCore(tree: string): void {
  fs.mkdirSync(path.join(tree, 'core'), { recursive: true });
  fs.copyFileSync(path.join(CORE, 'entries.json'), path.join(tree, 'core', 'entries.json'));
  if (coreGoEntries().length === 0) return;
  const bin = path.join(tree, 'core', 'bin', `${CORE_GOOS}-${CORE_GOARCH}`);
  fs.mkdirSync(bin, { recursive: true });
  fs.copyFileSync(coreBinary(), path.join(bin, coreExe()));
}
