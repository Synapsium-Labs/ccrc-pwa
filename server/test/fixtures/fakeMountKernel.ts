// A FAKE KERNEL FOR THE SIDECAR CARRY'S LINK ROUTE (D-4500): the one
// definition of the bind-mount geometry the route is written against, so no
// test file assembles its own.
//
// WHAT IS BEING FAKED, and why a fixture cannot just have it. On the fleet each
// `~/.claude-*` is its own bind mount of ONE filesystem, and link(2) answers
// EXDEV between two vfsmounts even on one superblock — measured on a real
// kernel. A fixture HOME is one directory on one mount, where every link
// succeeds, and an unprivileged test cannot bind-mount anything. So the two
// halves of that geometry are built separately:
//   * THE TABLE (`bindFixture`): a `mountinfo` in the kernel's exact format,
//     octal escapes included, naming each account root as its own mount of
//     device `0:99` and, unless the case says otherwise, the whole filesystem
//     at `<home>/vol`. Under `vol/home/` each account root appears again — as a
//     SYMLINK back to the real directory, so the alias is a different string
//     that resolves to the same inode, exactly as a second mount of the same
//     filesystem behaves. `decoy` makes those real directories instead, so the
//     alias names a DIFFERENT tree of the same shape: the case the route's
//     inode proof exists for.
//   * THE KERNEL (`plantFakeKernel`): a `sitecustomize.py` on PYTHONPATH that
//     makes `os.link` answer EXDEV when the two LEXICAL paths sit under
//     different mounts of that table (the longest mount point at a component
//     boundary — the vfsmount rule), and a bash `cp()` that fails `cp -al` the
//     same way, building the destination's top directory first because a real
//     `cp -al` builds the skeleton before its first EXDEV (measured). Lexical,
//     never resolved: a resolved path would see through the `vol/home/`
//     symlinks and call everything one mount, which is the one thing a bind
//     mount is not.
//
// The route itself reads the table through `CCD_MOUNTINFO`, the harness seam
// (`FIXTURE_MOUNTINFO` in `ccdWsHelpers.ts`); the fake kernel reads the same
// file through its own `FAKE_KERNEL_MOUNTINFO`, so a case can point the route
// at a different table (or none) while the kernel keeps its geometry.
// Without PYTHONPATH and the `cp()` stub, a case gets the real kernel — on a
// fixture, a link that just works — which is what the laziness case needs.
import fs from 'node:fs';
import path from 'node:path';
import { FIXTURE_MOUNTINFO } from '../ccdWsHelpers.js';

/** The fixture filesystem's `major:minor`: every account root and the whole
 *  mount are mounts of it. Exported so a case names it rather than typing it. */
export const FIXTURE_DEV = '0:99';

/** The kernel's escaping of a mountinfo path field: space, tab, newline and
 *  backslash as three-digit octal (`\040`, `\011`, `\012`, `\134`). */
export const mountEsc = (p: string): string =>
  p.replace(/[\\ \t\n]/g, (c) => `\\${c.charCodeAt(0).toString(8).padStart(3, '0')}`);

export interface MountRow {
  id: number;
  parent?: number;
  /** `major:minor`. The fixture filesystem is `FIXTURE_DEV`. */
  majmin: string;
  /** Where the mount sits INSIDE its filesystem (`/` for the whole of it). */
  root: string;
  /** Where it is mounted. */
  target: string;
  /** The per-mount options, `rw` or `ro` first. */
  opts?: string;
}

/** One `/proc/self/mountinfo` line: `id parent maj:min root target opts
 *  optional-fields - fstype source superopts`. */
export function mountRow(r: MountRow): string {
  return `${r.id} ${r.parent ?? 20} ${r.majmin} ${mountEsc(r.root)} ${mountEsc(r.target)} `
    + `${r.opts ?? 'rw,relatime'} shared:${r.id} - ext4 vol rw`;
}

export interface BindOpts {
  /** The whole filesystem's second mount at `<home>/<vol>`: read-write, read-only, or absent. */
  common?: 'rw' | 'ro' | 'none';
  /** `vol/home/<root>` as real directories copying each root's directory skeleton (no files), not symlinks. */
  decoy?: boolean;
  /** The second mount's directory name under HOME (default `vol`). */
  vol?: string;
  /** Further rows, appended after the account roots (later rows win a shared target). */
  extra?: string[];
  /** The account roots, each its own mount (default `.claude`, `.claude-d`). */
  roots?: string[];
}

/** Every directory under `src`, recreated under `dst` — no files. */
function skeleton(src: string, dst: string): void {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (e.isDirectory()) skeleton(path.join(src, e.name), path.join(dst, e.name));
  }
}

/** The geometry's mount TABLE alone, as text: nothing is written. A case
 *  that needs a second table for one geometry (the same roots, say, with no
 *  common mount) asks for it here rather than editing the first one's rows. */
export function fixtureTable(home: string, o: BindOpts = {}): string {
  const roots = o.roots ?? ['.claude', '.claude-d'];
  const vol = path.join(home, o.vol ?? 'vol');
  const common = o.common ?? 'rw';
  return [
    mountRow({ id: 20, parent: 1, majmin: '8:1', root: '/', target: '/' }),
    ...(common === 'none' ? [] : [mountRow({ id: 29, majmin: FIXTURE_DEV, root: '/', target: vol, opts: `${common},relatime` })]),
    ...roots.map((r, i) => mountRow({ id: 31 + i, majmin: FIXTURE_DEV, root: `/home/${r}`, target: path.join(home, r) })),
    ...(o.extra ?? []), ''].join('\n');
}

/** Build the geometry under `home` and write its table at the harness's
 *  `FIXTURE_MOUNTINFO`. Call it AFTER planting the sidecars when `decoy` is set:
 *  the decoy copies the directory shape that exists at that moment. Returns the
 *  environment both the route and the fake kernel read. */
export function bindFixture(home: string, o: BindOpts = {}): Record<string, string> {
  const roots = o.roots ?? ['.claude', '.claude-d'];
  const vol = path.join(home, o.vol ?? 'vol');
  fs.mkdirSync(path.join(vol, 'home'), { recursive: true });
  for (const r of roots) {
    fs.mkdirSync(path.join(home, r), { recursive: true });
    const alias = path.join(vol, 'home', r);
    if (o.decoy) skeleton(path.join(home, r), alias);
    else fs.symlinkSync(path.join(home, r), alias);
  }
  const mi = path.join(home, FIXTURE_MOUNTINFO);
  fs.writeFileSync(mi, fixtureTable(home, o));
  return { CCD_MOUNTINFO: mi, FAKE_KERNEL_MOUNTINFO: mi };
}

const SITECUSTOMIZE = `# TEST-ONLY fake kernel (server/test/fixtures/fakeMountKernel.ts). link(2)
# answers EXDEV when the two LEXICAL paths sit under different mounts of the
# fixture table: the longest mount point at a component boundary, a later row
# winning a shared target — the vfsmount rule a bind mount trips.
import errno, os, re

def _unesc(b):
    return os.fsdecode(re.sub(rb'\\\\([0-7]{3})', lambda m: bytes([int(m.group(1), 8)]), b))

def _targets():
    with open(os.environ['FAKE_KERNEL_MOUNTINFO'], 'rb') as fh:
        return [_unesc(f[4]) for f in (line.split(b' ') for line in fh.read().split(b'\\n')) if len(f) >= 10]

def mount_of(p):
    best = None
    for m in _targets():
        if (m == '/' or p == m or p.startswith(m + '/')) and (best is None or len(m) >= len(best)):
            best = m
    return best

_real_link = os.link

def _fake_link(a, b, *k, **kw):
    forced = os.environ.get('FAKE_LINK_ERRNO')
    if forced:
        n = getattr(errno, forced)
        raise OSError(n, os.strerror(n), a, None, b)
    if mount_of(os.path.abspath(a)) != mount_of(os.path.abspath(b)):
        raise OSError(errno.EXDEV, os.strerror(errno.EXDEV), a, None, b)
    return _real_link(a, b, *k, **kw)

if os.environ.get('FAKE_KERNEL_MOUNTINFO'):
    os.link = _fake_link

if os.environ.get('FAKE_ROUTE_CRASH'):
    def _boom(*a, **k):
        raise RuntimeError('fake route crash')
    os.path.realpath = _boom
`;

const SAMEMOUNT = `# TEST-ONLY: exit 0 iff SRC and DST's parent sit on one fake mount (cp -al's question).
import os, sys
import sitecustomize as k
sys.exit(0 if k.mount_of(os.path.abspath(sys.argv[1])) == k.mount_of(os.path.dirname(os.path.abspath(sys.argv[2]))) else 1)
`;

/** Plant the fake kernel under `<home>/.fake-kernel/`. `env` puts it on
 *  PYTHONPATH; `cpStub` is a bash `cp()` to prepend to a snippet: `cp -al`
 *  fails (after `mkdir -p` of its destination, as a real EXDEV leaves it) when
 *  the source and the destination's parent sit on different fake mounts, or
 *  always under `FAKE_CP_AL_FAIL=1`; every other `cp` is the real one.
 *  `FAKE_LINK_ERRNO=<name>` forces that errno on every `os.link`, and
 *  `FAKE_ROUTE_CRASH=1` makes `os.path.realpath` raise. */
export function plantFakeKernel(home: string): { env: Record<string, string>; cpStub: string } {
  const dir = path.join(home, '.fake-kernel');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'sitecustomize.py'), SITECUSTOMIZE);
  fs.writeFileSync(path.join(dir, 'samemount.py'), SAMEMOUNT);
  const cpStub = 'cp() { if [[ "$1" == -al ]]; then '
    + `if [[ -n "\${FAKE_CP_AL_FAIL:-}" ]] || ! python3 "${dir}/samemount.py" "$2" "$3"; then mkdir -p "$3"; return 1; fi; fi; `
    + 'command cp "$@"; };';
  return { env: { PYTHONPATH: dir }, cpStub };
}
