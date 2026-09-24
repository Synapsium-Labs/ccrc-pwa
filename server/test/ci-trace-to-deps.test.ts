// `.github/ci/trace-to-deps.mjs` (spec §5.1-5.2, contract Task 3): parses `strace -f -ff -ttt -y -qq` output — one
// file per THREAD (`-ff` names each `t.<tid>`), as produced by `traceArgv` (Task 7) — into a repo-relative
// `DepRecord`.
//
// Every fixture below is modelled on REAL `strace 6.8` output, captured by hand against this repo's own test files
// under the invocation `trace-run.mjs` uses (`CCRC_TEST_LIST=<one file> vitest run --config vitest.select.config.ts
// --maxWorkers=1`). The trace list is now `trace=openat,openat2,open,newfstatat,statx,access,faccessat2,readlink,
// readlinkat,getdents64,execve,execveat,symlink,symlinkat,chdir,fchdir,clone,clone3` with `-f -ff -ttt -y -qq`;
// the first captures were taken with the shorter list `openat,openat2,open,newfstatat,statx,access,faccessat2,
// readlinkat,getdents64,execve,execveat` and without `-ttt`, which is why most fixtures carry no timestamp (the
// parser orders a line without one by file order):
//   - `test/bus.test.ts`, `test/oss-metadata.test.ts`, `test/ccd-rc-flag.test.ts`, `test/worker-skill.test.ts`,
//     `test/ci-baseline.test.ts` each traced individually.
// The `readlink` shapes (a later addition to the trace list) are from a real `strace 6.8 -f -y -e trace=readlink`
// capture of `fs.realpathSync.native` on a missing path, a symlink and a regular file. The `statx`, `faccessat2`,
// `openat2`, `readlinkat` and `execveat` shapes (final review FR-7) are from real `strace 6.8 -f -ff -ttt -y -qq`
// captures on this box: coreutils `stat` (statx), `test -x` (faccessat2 with AT_EACCESS), and Python's
// `os.readlink(…, dir_fd=…)` and raw `syscall(2)` calls for openat2 and execveat, which nothing in the suite
// happened to make.
// The exact syscall shapes below (argument order, the `-y` dirfd/fd annotations, the ENOENT error text, the
// absence of a `<resolved>` annotation on non-fd-returning success) are copied from those real captures, with
// only the path PREFIXES substituted for a synthetic `/repo` fixture root so the numbers stay small and the
// intent stays legible. A few shapes real fixtures never happened to exercise (an AT_FDCWD-relative ENOENT
// probe, a numbered-fd relative resolution landing inside the repo) are constructed in strace's documented
// syntax, following the exact grammar the real captures established for their siblings.
import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { mkTmp } from './tmpHelpers.js';
import { parseTraceDir, parseTraceDirDetailed, parseTraceDirSplit } from '../../.github/ci/trace-to-deps.mjs';

/** Writes one pid's trace file (`t.<pid>`) into a fresh trace dir and returns the dir. */
function traceDirWith(files: Record<string, string>): string {
  const dir = mkTmp('ccrc-trace-fixture-');
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(path.join(dir, name), content, 'utf8');
  }
  return dir;
}

// `parseTraceDir`'s contract realpath's `repoRoot` (Task 3), so the fixture root must be a directory that
// actually exists on disk -- a real (auto-removed) tmp dir stands in for the checkout.
const REPO = mkTmp('ccrc-trace-fixture-repo-');

describe('parseTraceDir', () => {
  it('records a successful openat of a repo file as read, real capture shape', () => {
    // Real capture (test/bus.test.ts), path prefix substituted:
    const dir = traceDirWith({
      't.1001': [
        'execve("./node_modules/.bin/vitest", ["./node_modules/.bin/vitest", "run", "--config", "vitest.select.config.ts", "--maxWorkers=1"], 0x7fff62010030 /* 46 vars */) = 0',
        `openat(AT_FDCWD<${REPO}/server>, "${REPO}/server/test/bus.test.ts", O_RDONLY|O_CLOEXEC) = 22<${REPO}/server/test/bus.test.ts>`,
      ].join('\n') + '\n',
    });
    const rec = parseTraceDir(dir, REPO);
    expect(rec.read).toContain('server/test/bus.test.ts');
    expect(rec.git).toBe(false);
  });

  it('aggregates a read recorded only in a GRANDCHILD pid file (multi-process trace dir)', () => {
    // -ff writes one file per pid regardless of process depth; a grandchild's own reads live in its OWN file,
    // never the parent's. The parser must merge across every file in the dir.
    const dir = traceDirWith({
      't.2000': [ // the top-level vitest process: no repo-file read here
        'execve("/usr/bin/node", ["node", "./node_modules/.bin/vitest", "run"], 0x7ffeb45a0f08 /* 46 vars */) = 0',
      ].join('\n') + '\n',
      't.2001': [ // child: a bash subprocess launched by a test
        'execve("/usr/bin/bash", ["bash", "-c", "ccd status"], 0x7ffeb45a0f08 /* 46 vars */) = 0',
      ].join('\n') + '\n',
      't.2002': [ // grandchild: the ccd script itself, forked from the bash child above
        `openat(AT_FDCWD<${REPO}>, "${REPO}/ccd/ccd", O_RDONLY) = 3<${REPO}/ccd/ccd>`,
      ].join('\n') + '\n',
    });
    const rec = parseTraceDir(dir, REPO);
    expect(rec.read).toContain('ccd/ccd');
  });

  it('records an ENOENT probe with an AT_FDCWD-relative path as probed', () => {
    // Real capture shape for a successful AT_FDCWD-relative newfstatat (test/ccd-rc-flag.test.ts):
    //   newfstatat(AT_FDCWD<cwd>, ".cc-sessions", {st_mode=...}, 0) = 0
    // The ENOENT failure shares the same grammar; strace prints no trailing struct on failure.
    const dir = traceDirWith({
      't.3001': [
        `newfstatat(AT_FDCWD<${REPO}/server>, "fixtures.missing", 0x7ffd1234, AT_SYMLINK_NOFOLLOW) = -1 ENOENT (No such file or directory)`,
      ].join('\n') + '\n',
    });
    const rec = parseTraceDir(dir, REPO);
    expect(rec.probed).toContain('server/fixtures.missing');
    expect(rec.read).not.toContain('server/fixtures.missing');
  });

  it('records a getdents64 directory enumeration as listed, real capture shape', () => {
    // Real capture (test/ci-baseline.test.ts): vitest's include glob lists server/test/.
    const dir = traceDirWith({
      't.4001': [
        `getdents64(20<${REPO}/server/test>, 0x7df18c000ba0 /* 401 entries */, 32768) = 18048`,
        `getdents64(20<${REPO}/server/test>, 0x7df18c000ba0 /* 0 entries */, 32768) = 0`,
      ].join('\n') + '\n',
    });
    const rec = parseTraceDir(dir, REPO);
    expect(rec.listed).toEqual(['server/test']);
  });

  it('records a .git read as the git flag, not in read/probed/listed, real capture shape', () => {
    // Real capture shape (test/worker-skill.test.ts's fixture git repo, path prefix substituted onto the repo
    // root itself so this fixture demonstrates the REPO's OWN .git):
    //   access(".git/config", R_OK) = 0
    // resolved via the AT_FDCWD annotation on a preceding line in the same pid file, exactly as real git
    // subprocesses do when they run at the repo root.
    const dir = traceDirWith({
      't.5001': [
        `openat(AT_FDCWD<${REPO}>, "${REPO}/package.json", O_RDONLY) = -1 ENOENT (No such file or directory)`,
        `access(".git/config", R_OK) = 0`,
        `access(".git/hooks/pre-commit", R_OK) = -1 ENOENT (No such file or directory)`,
      ].join('\n') + '\n',
    });
    const rec = parseTraceDir(dir, REPO);
    expect(rec.git).toBe(true);
    // "package.json" is a genuine ENOENT probe unrelated to .git, kept as evidence the two buckets don't collide.
    expect(rec.probed).toContain('package.json');
    expect(rec.read.some((p) => p === '.git' || p.startsWith('.git/'))).toBe(false);
    expect(rec.probed.some((p) => p === '.git' || p.startsWith('.git/'))).toBe(false);
  });

  it('drops a path under a node_modules segment', () => {
    // Real capture shape (any test file): node's own resolver probing node_modules.
    const dir = traceDirWith({
      't.6001': [
        `openat(AT_FDCWD<${REPO}/server>, "${REPO}/server/node_modules/vitest/dist/index.js", O_RDONLY|O_CLOEXEC) = 25<${REPO}/server/node_modules/vitest/dist/index.js>`,
      ].join('\n') + '\n',
    });
    const rec = parseTraceDir(dir, REPO);
    expect(rec.read).toEqual([]);
    expect(rec.probed).toEqual([]);
  });

  it('drops a path outside the repo, real capture shape (a fixture HOME under /tmp)', () => {
    // Real capture (test/ccd-rc-flag.test.ts): a fixture harness HOME lives under /tmp, well outside the repo.
    const dir = traceDirWith({
      't.7001': [
        `openat(22<${REPO}-unrelated-fixture-home>, ".ccrc", O_RDONLY|O_NONBLOCK|O_CLOEXEC|O_DIRECTORY) = -1 ENOENT (No such file or directory)`,
        `openat(AT_FDCWD</tmp/ccrc-ccd-rc-flag-Lb1OUz>, "/tmp/ccrc-ccd-rc-flag-Lb1OUz/.ccrc/accounts.sh", O_RDONLY) = 6</tmp/ccrc-ccd-rc-flag-Lb1OUz/.ccrc/accounts.sh>`,
      ].join('\n') + '\n',
    });
    const rec = parseTraceDir(dir, REPO);
    expect(rec.read).toEqual([]);
    expect(rec.probed).toEqual([]);
  });

  it('records an absolute execve of a repo path as read', () => {
    const dir = traceDirWith({
      't.8001': [
        `execve("${REPO}/ccd/ccd", ["ccd", "status"], 0x45eee880 /* 58 vars */) = 0`,
      ].join('\n') + '\n',
    });
    const rec = parseTraceDir(dir, REPO);
    expect(rec.read).toContain('ccd/ccd');
  });

  it('ignores a relative execve (the interpreter\'s own openat of the script records it instead)', () => {
    // Real capture (every test file's top-level vitest launch): execve("./node_modules/.bin/vitest", ...).
    const dir = traceDirWith({
      't.9001': [
        'execve("./node_modules/.bin/vitest", ["./node_modules/.bin/vitest", "run"], 0x7fff62010030 /* 46 vars */) = 0',
      ].join('\n') + '\n',
    });
    const { record, unresolved } = parseTraceDirDetailed(dir, REPO);
    expect(record.read).toEqual([]);
    expect(record.probed).toEqual([]);
    // A relative execve is IGNORED, not unresolved: it never even attempts cwd resolution.
    expect(unresolved).toBe(0);
  });

  it('resolves a relative access() against the pid\'s last-seen cwd when that cwd is inside the repo', () => {
    const dir = traceDirWith({
      't.10001': [
        `openat(AT_FDCWD<${REPO}/server>, "${REPO}/server/package.json", O_RDONLY) = 3<${REPO}/server/package.json>`,
        `access("tsconfig.json", F_OK) = 0`,
      ].join('\n') + '\n',
    });
    const rec = parseTraceDir(dir, REPO);
    expect(rec.read).toContain('server/tsconfig.json');
  });

  it('resolves a relative access() against the pid\'s last-seen cwd when that cwd is OUTSIDE the repo (dropped)', () => {
    // Real capture (test/worker-skill.test.ts's fixture git repo): git commands run with cwd = a fixture
    // producer directory under /tmp, well outside the repo, and their relative .git/* reads resolve there.
    const dir = traceDirWith({
      't.10101': [
        `openat(AT_FDCWD</tmp/ccrc-producer-read-Ubndi0/producer>, "/home/user/.gitconfig", O_RDONLY) = 5</home/user/.gitconfig>`,
        `access(".git/config", R_OK) = 0`,
      ].join('\n') + '\n',
    });
    const rec = parseTraceDir(dir, REPO);
    expect(rec.read).toEqual([]);
    expect(rec.git).toBe(false);
  });

  it('counts an unresolvable relative path (no cwd seen anywhere in the pid file) as unresolved', () => {
    const dir = traceDirWith({
      't.11001': [
        `access("some-relative-file", F_OK) = 0`,
      ].join('\n') + '\n',
    });
    const { record, unresolved } = parseTraceDirDetailed(dir, REPO);
    expect(unresolved).toBe(1);
    expect(record.read).toEqual([]);
    expect(record.probed).toEqual([]);
  });

  it('falls back to the FIRST cwd seen later in the pid file when none precedes the relative access()', () => {
    const dir = traceDirWith({
      't.11101': [
        `access("tsconfig.json", F_OK) = 0`, // no cwd seen yet at this point
        `openat(AT_FDCWD<${REPO}/server>, "${REPO}/server/package.json", O_RDONLY) = 3<${REPO}/server/package.json>`,
      ].join('\n') + '\n',
    });
    const { record, unresolved } = parseTraceDirDetailed(dir, REPO);
    expect(unresolved).toBe(0);
    expect(record.read).toContain('server/tsconfig.json');
  });

  it('marks a repo root itself (the exact repo dir) as "."', () => {
    const dir = traceDirWith({
      't.12001': [
        `newfstatat(AT_FDCWD<${REPO}>, "${REPO}", {st_mode=S_IFDIR|0775, st_size=4096, ...}, 0) = 0`,
      ].join('\n') + '\n',
    });
    const rec = parseTraceDir(dir, REPO);
    expect(rec.read).toContain('.');
  });

  it('treats a trailing-slash directory open as the same path as its slash-free sibling (real capture shape)', () => {
    // Real capture (test/ci-baseline.test.ts): Node opens a directory it is about to readdir as `"…/test/"`
    // (trailing slash on the ARGUMENT), while strace's own `<resolved>` fd annotation for the same open never
    // carries one -- so without normalization the two spellings dedupe as two different `read` entries for one
    // directory.
    const dir = traceDirWith({
      't.15001': [
        `openat(AT_FDCWD<${REPO}/server>, "${REPO}/server/test/", O_RDONLY|O_NONBLOCK|O_CLOEXEC|O_DIRECTORY) = 20<${REPO}/server/test>`,
        `openat(AT_FDCWD<${REPO}/server>, "${REPO}/server/test", O_RDONLY|O_CLOEXEC) = 21<${REPO}/server/test>`,
      ].join('\n') + '\n',
    });
    const rec = parseTraceDir(dir, REPO);
    expect(rec.read).toEqual(['server/test']);
  });

  it('deduplicates and sorts every field', () => {
    const dir = traceDirWith({
      't.13001': [
        `openat(AT_FDCWD<${REPO}/server>, "${REPO}/server/test/bus.test.ts", O_RDONLY) = 3<${REPO}/server/test/bus.test.ts>`,
        `openat(AT_FDCWD<${REPO}/server>, "${REPO}/server/test/bus.test.ts", O_RDONLY) = 3<${REPO}/server/test/bus.test.ts>`,
        `openat(AT_FDCWD<${REPO}/server>, "${REPO}/server/test/oss-metadata.test.ts", O_RDONLY) = 4<${REPO}/server/test/oss-metadata.test.ts>`,
      ].join('\n') + '\n',
    });
    const rec = parseTraceDir(dir, REPO);
    expect(rec.read).toEqual(['server/test/bus.test.ts', 'server/test/oss-metadata.test.ts']);
  });
});

describe('parseTraceDir: every dirfd syscall of the trace list, in its real shape (final review FR-7)', () => {
  // One case per syscall DIRFD_PATH_RE names beyond openat/newfstatat, so dropping any one of them from that
  // regex turns its case red: the line then matches nothing at all, and records nothing. Real strace 6.8 captures
  // (see the header), prefixes substituted.
  it('statx: a successful stat is read, an ENOENT probe is probed (AT_FDCWD-relative)', () => {
    const dir = traceDirWith({
      't.17001': [
        `1790239040.100001 statx(AT_FDCWD<${REPO}>, "ccd/tool", AT_STATX_SYNC_AS_STAT|AT_SYMLINK_NOFOLLOW|AT_NO_AUTOMOUNT, STATX_ALL, {stx_mask=STATX_ALL|STATX_MNT_ID, stx_attributes=0, stx_mode=S_IFREG|0775, stx_size=18, ...}) = 0`,
        `1790239040.100002 statx(AT_FDCWD<${REPO}>, "ccd/missing", AT_STATX_SYNC_AS_STAT|AT_SYMLINK_NOFOLLOW|AT_NO_AUTOMOUNT, STATX_ALL, 0x7ffc14627230) = -1 ENOENT (No such file or directory)`,
      ].join('\n') + '\n',
    });
    const rec = parseTraceDir(dir, REPO);
    expect(rec.read).toEqual(['ccd/tool']);
    expect(rec.probed).toEqual(['ccd/missing']);
  });

  it('faccessat2: an X_OK check that passes is read, one that meets ENOENT is probed', () => {
    const dir = traceDirWith({
      't.17101': [
        `1790239041.200001 faccessat2(AT_FDCWD<${REPO}>, "ccd/tool", X_OK, AT_EACCESS) = 0`,
        `1790239041.200002 faccessat2(AT_FDCWD<${REPO}>, "ccd/missing", X_OK, AT_EACCESS) = -1 ENOENT (No such file or directory)`,
      ].join('\n') + '\n',
    });
    const rec = parseTraceDir(dir, REPO);
    expect(rec.read).toEqual(['ccd/tool']);
    expect(rec.probed).toEqual(['ccd/missing']);
  });

  it('openat2: an absolute open is read (and its fd\'s resolved path), a dirfd-relative ENOENT is probed', () => {
    const dir = traceDirWith({
      't.17201': [
        `1790239052.783075 openat2(AT_FDCWD<${REPO}>, "${REPO}/ccd/tool", {flags=O_RDONLY|O_CLOEXEC, resolve=0}, 24) = 4<${REPO}/ccd/tool>`,
        `1790239052.783160 openat2(3<${REPO}/ccd>, "missing", {flags=O_RDONLY|O_CLOEXEC, resolve=0}, 24) = -1 ENOENT (No such file or directory)`,
        `1790239052.783214 openat2(3<${REPO}/ccd>, "other", {flags=O_RDONLY|O_CLOEXEC, resolve=0}, 24) = 5<${REPO}/ccd/other>`,
      ].join('\n') + '\n',
    });
    const rec = parseTraceDir(dir, REPO);
    expect(rec.read).toEqual(['ccd/other', 'ccd/tool']);
    expect(rec.probed).toEqual(['ccd/missing']);
  });

  it('readlinkat: a link read through a dirfd is read, a missing one probed', () => {
    const dir = traceDirWith({
      't.17301': [
        `1790239052.782672 readlinkat(3<${REPO}/ccd>, "link", "tool", 4096) = 4`,
        `1790239052.782861 readlinkat(3<${REPO}/ccd>, "missing", 0x7ffea3779150, 4096) = -1 ENOENT (No such file or directory)`,
      ].join('\n') + '\n',
    });
    const rec = parseTraceDir(dir, REPO);
    expect(rec.read).toEqual(['ccd/link']);
    expect(rec.probed).toEqual(['ccd/missing']);
  });

  it('execveat: a script run through a dirfd is read, a missing one probed', () => {
    const dir = traceDirWith({
      't.17401': [
        `1790239052.784676 execveat(3<${REPO}/ccd>, "missing", ["tool"], 0x7ee4be3816a0 /* 0 vars */, 0) = -1 ENOENT (No such file or directory)`,
        `1790239061.125620 execveat(3<${REPO}/ccd>, "tool", ["tool"], 0x740249b61620 /* 0 vars */, 0) = 0`,
      ].join('\n') + '\n',
    });
    const rec = parseTraceDir(dir, REPO);
    expect(rec.read).toEqual(['ccd/tool']);
    expect(rec.probed).toEqual(['ccd/missing']);
  });
});

describe('parseTraceDir: readlink (the syscall realpathSync.native probes with)', () => {
  // Measured: `fs.realpathSync.native('missing/x')` emits ONLY `readlink("<abs>/missing", …) = -1 ENOENT` — no
  // stat, no open — so without readlink in the trace list that probe is invisible. readlink carries no dirfd:
  // a relative path resolves against the pid's cwd, exactly like access().
  it('an ENOENT readlink is probed, a successful one read (real capture shapes)', () => {
    const dir = traceDirWith({
      't.16001': [
        `readlink("${REPO}/server/missing", 0x7ffc25c72ac0, 1023) = -1 ENOENT (No such file or directory)`,
        `readlink("${REPO}/server/link.txt", "real.txt", 1023) = 8`,
      ].join('\n') + '\n',
    });
    const rec = parseTraceDir(dir, REPO);
    expect(rec.probed).toEqual(['server/missing']);
    expect(rec.read).toEqual(['server/link.txt']);
  });

  it('an EINVAL readlink is read: the path exists, it just is not a symlink (real capture shape)', () => {
    // realpathSync.native walks every component with readlink; a regular file answers EINVAL. A test that only
    // realpaths a file still depends on it existing, so deleting it must select the test (rule 3 reads `read`).
    const dir = traceDirWith({
      't.16201': [
        `readlink("${REPO}/server/real.txt", 0x7ffc25c72ac0, 1023) = -1 EINVAL (Invalid argument)`,
        `openat(AT_FDCWD<${REPO}/server>, "${REPO}/server/package.json", O_RDONLY) = 3<${REPO}/server/package.json>`,
        `readlink("rel.txt", 0x7ffc25c72ac0, 1023) = -1 EINVAL (Invalid argument)`,
        `access("${REPO}/server/other.txt", F_OK) = -1 EINVAL (Invalid argument)`,
      ].join('\n') + '\n',
    });
    const rec = parseTraceDir(dir, REPO);
    expect(rec.read).toEqual(['server/package.json', 'server/real.txt', 'server/rel.txt']);
    expect(rec.probed).toEqual([]);
  });

  it('a relative readlink resolves against the pid\'s cwd, like access()', () => {
    const dir = traceDirWith({
      't.16101': [
        `openat(AT_FDCWD<${REPO}/server>, "${REPO}/server/package.json", O_RDONLY) = 3<${REPO}/server/package.json>`,
        `readlink("gone/x", 0x7ffc25c72ac0, 1023) = -1 ENOENT (No such file or directory)`,
      ].join('\n') + '\n',
    });
    const { record, unresolved } = parseTraceDirDetailed(dir, REPO);
    expect(unresolved).toBe(0);
    expect(record.probed).toEqual(['server/gone/x']);
  });
});

describe('reads through a symlink: the resolved path of an opened fd, and a created link\'s target', () => {
  // Real shapes (strace 6.8 -y): opening a symlink prints the fd's RESOLVED path after `=`, and node's
  // fs.symlinkSync emits `symlink(target, linkpath)` while coreutils `ln -s` emits `symlinkat(target, dirfd,
  // linkpath)`. ccrc-models and its siblings build a fixture box by symlinking repo files into a tmp HOME and
  // run them there, so the argument path is outside the repo and only these two record the repo file.
  it('a successful open of a path outside the repo records the repo file its fd resolved to', () => {
    const dir = traceDirWith({
      't.17001': [
        `openat(AT_FDCWD</tmp/box>, "/tmp/box/ccd/ccrc-models-probe", O_RDONLY) = 3<${REPO}/ccd/ccrc-models-probe>`,
        `open("/tmp/box/lib.sh", O_RDONLY|O_CLOEXEC) = 4<${REPO}/ccd/ccrc-wrapper-shape>`,
        `openat(AT_FDCWD</tmp/box>, "/tmp/box/gone", O_RDONLY) = -1 ENOENT (No such file or directory)`,
      ].join('\n') + '\n',
    });
    const rec = parseTraceDir(dir, REPO);
    expect(rec.read).toEqual(['ccd/ccrc-models-probe', 'ccd/ccrc-wrapper-shape']);
    expect(rec.probed).toEqual([]);
  });

  it('a created symlink records its in-repo TARGET as read — absolute, or relative to the link\'s directory', () => {
    const dir = traceDirWith({
      't.17101': [
        `symlink("${REPO}/ccd/ccrc", "box/ccd/ccrc") = 0`,
        `symlinkat("${REPO}/deploy", AT_FDCWD</tmp/box>, "deploy") = 0`,
        `symlinkat("../ccd/x", AT_FDCWD<${REPO}/server>, "lnk") = 0`,
        `symlinkat("${REPO}/ccd/exists", AT_FDCWD</tmp/box>, "dup") = -1 EEXIST (File exists)`,
        `symlink("/usr/bin/env", "box/env") = 0`,
      ].join('\n') + '\n',
    });
    const { record, unresolved } = parseTraceDirDetailed(dir, REPO);
    expect(record.read).toEqual(['ccd/ccrc', 'ccd/x', 'deploy']);
    expect(unresolved).toBe(0);
  });

  it('a symlink to an in-repo DIRECTORY records it as subtree (checked on disk when parsed); a file or dangling target stays read', () => {
    // What is later stat'ed or probed THROUGH a directory link leaves no resolved path of its own (a stat returns
    // no fd), so the whole directory is the record: any change at or under it selects the test (rule 6).
    mkdirSync(path.join(REPO, 'subtree-case', 'deploy', 'nested'), { recursive: true });
    writeFileSync(path.join(REPO, 'subtree-case', 'file.sh'), 'x\n');
    const dir = traceDirWith({
      't.17201': [
        `symlinkat("${REPO}/subtree-case/deploy", AT_FDCWD</tmp/box>, "deploy") = 0`,
        `symlinkat("../subtree-case/deploy/nested", AT_FDCWD<${REPO}/server>, "n") = 0`,
        `symlink("${REPO}/subtree-case/file.sh", "/tmp/box/file.sh") = 0`,
        `symlink("${REPO}/subtree-case/gone", "/tmp/box/gone") = 0`,
        `symlink("${REPO}", "/tmp/box/whole-repo") = 0`,
        `newfstatat(AT_FDCWD</tmp/box>, "/tmp/box/deploy/present.mjs", {st_mode=S_IFREG|0644, st_size=1, ...}, 0) = 0`,
        `newfstatat(AT_FDCWD</tmp/box>, "/tmp/box/deploy/absent.mjs", 0x7ffc, 0) = -1 ENOENT (No such file or directory)`,
      ].join('\n') + '\n',
    });
    expect(parseTraceDir(dir, REPO)).toEqual({
      read: ['subtree-case/file.sh', 'subtree-case/gone'], probed: [], listed: [],
      subtree: ['.', 'subtree-case/deploy', 'subtree-case/deploy/nested'], git: false,
    });
  });
});

describe('the cwd of a dirfd-less relative path, tracked through chdir in time order (-ttt)', () => {
  // open/access/readlink/symlink carry no dirfd, so a relative path needs the process's cwd at that moment. The
  // trace carries `chdir`/`fchdir` and a `-ttt` timestamp on every line, and the process's events — across all
  // its threads' files — are replayed in time order: AT_FDCWD<…> says what the cwd is, chdir/fchdir move it.
  // Measured why this is needed: git chdirs to the work tree before `access(".git/config")`, so every test that
  // runs git would otherwise be unknown (worker-skill 45 unresolved paths, ccd-account-ok 318, session-hook
  // 8256 under a "never chdir'd" rule), and the old per-file "last cwd seen" rule joined the path to the stale
  // cwd (`process.chdir('<repo>/ccd'); fs.existsSync('x')` recorded server/x).
  const t = (s: number, line: string) => `1727000000.${String(s).padStart(6, '0')} ${line}`;

  it('after a chdir, a relative access resolves against the NEW cwd', () => {
    const dir = traceDirWith({
      't.18001': [
        t(1, `openat(AT_FDCWD<${REPO}/server>, "${REPO}/server/package.json", O_RDONLY) = 3<${REPO}/server/package.json>`),
        t(2, `chdir("${REPO}/ccd")                     = 0`),
        t(3, `access("nope-rel-probe", F_OK) = -1 ENOENT (No such file or directory)`),
      ].join('\n') + '\n',
    });
    expect(parseTraceDirDetailed(dir, REPO)).toEqual({
      record: { read: ['server/package.json'], probed: ['ccd/nope-rel-probe'], listed: [], subtree: [], git: false }, unresolved: 0,
    });
  });

  it('before the chdir the old cwd holds; a relative chdir moves relative to it; fchdir takes its fd\'s path', () => {
    const dir = traceDirWith({
      't.18101': [
        t(1, `openat(AT_FDCWD<${REPO}/server>, "${REPO}/server/package.json", O_RDONLY) = 3<${REPO}/server/package.json>`),
        t(2, `access("a", F_OK) = 0`),
        t(3, `chdir("../ccd")                          = 0`),
        t(4, `access("b", F_OK) = 0`),
        t(5, `fchdir(5<${REPO}/deploy>)                = 0`),
        t(6, `access("c", F_OK) = 0`),
        t(7, `chdir("${REPO}/nowhere") = -1 ENOENT (No such file or directory)`),
        t(8, `access("d", F_OK) = 0`),
      ].join('\n') + '\n',
    });
    expect(parseTraceDirDetailed(dir, REPO)).toEqual({
      record: { read: ['ccd/b', 'deploy/c', 'deploy/d', 'server/a', 'server/package.json'], probed: [], listed: [], subtree: [], git: false },
      unresolved: 0,
    });
  });

  it('threads share one cwd: a chdir in one thread moves the cwd for another thread\'s LATER calls only', () => {
    const clone = `clone3({flags=CLONE_VM|CLONE_FS|CLONE_FILES|CLONE_SIGHAND|CLONE_THREAD|CLONE_SYSVSEM|CLONE_SETTLS|CLONE_PARENT_SETTID|CLONE_CHILD_CLEARTID, child_tid=0x1, parent_tid=0x1, exit_signal=0, stack=0x1, stack_size=0x1, tls=0x1} => {parent_tid=[18302]}, 88) = 18302`;
    // The leader moves the cwd at t=5; the only annotation is the thread's, at t=2, in a file read AFTER the
    // leader's — so the events must be replayed by time, not by file, and across the thread group.
    const dir = traceDirWith({
      't.18301': [
        t(1, clone),
        t(5, `chdir("${REPO}/ccd") = 0`),
      ].join('\n') + '\n',
      't.18302': [
        t(2, `openat(AT_FDCWD<${REPO}/server>, "${REPO}/server/package.json", O_RDONLY) = 3<${REPO}/server/package.json>`),
        t(3, `access("early", F_OK) = 0`),
        t(7, `access("late", F_OK) = 0`),
      ].join('\n') + '\n',
    });
    expect(parseTraceDirDetailed(dir, REPO)).toEqual({
      record: { read: ['ccd/late', 'server/early', 'server/package.json'], probed: [], listed: [], subtree: [], git: false }, unresolved: 0,
    });
  });

  it('with no known cwd, a relative path is unresolved — and so is one after a relative chdir from an unknown cwd', () => {
    const dir = traceDirWith({
      't.18401': [t(1, `access("rel", F_OK) = 0`)].join('\n') + '\n',
      't.18402': [
        t(1, `openat(AT_FDCWD<${REPO}/server>, "a", O_RDONLY) = 3<${REPO}/server/a>`),
        t(2, `openat(AT_FDCWD<${REPO}/ccd>, "b", O_RDONLY) = 4<${REPO}/ccd/b>`),
        t(3, `chdir("sub") = 0`),
        t(4, `access("rel", F_OK) = 0`),
      ].join('\n') + '\n',
    });
    // t.18402: two cwds before any traced chdir (an untraced move) — its start is unknown, so "sub" is too.
    expect(parseTraceDirDetailed(dir, REPO).unresolved).toBe(2);
  });

  it('a relative call in the SAME microsecond as a move is unresolved: the stamp cannot order the two', () => {
    const dir = traceDirWith({
      't.18501': [
        t(1, `openat(AT_FDCWD<${REPO}/server>, "${REPO}/server/package.json", O_RDONLY) = 3<${REPO}/server/package.json>`),
        t(5, `chdir("${REPO}/ccd") = 0`),
        t(5, `access("tie", F_OK) = 0`),
        t(6, `access("after", F_OK) = 0`),
      ].join('\n') + '\n',
    });
    expect(parseTraceDirDetailed(dir, REPO)).toEqual({
      record: { read: ['ccd/after', 'server/package.json'], probed: [], listed: [], subtree: [], git: false }, unresolved: 1,
    });
  });
});

describe('parseTraceDirSplit (the vitest root process apart from every other process)', () => {
  // vitest's own startup — the config, the include glob's walk of `server/test/` — happens in the vitest ROOT
  // process; what a test file itself does happens in its worker and in whatever that spawns. The baseline is
  // subtracted per side, so a test that walks `server/test/` in its own right (single-definition's census) keeps
  // that listing even though the root's glob walk of the same directory is subtracted.
  //
  // `-ff` writes one file per THREAD, not per process, and the glob's walk is measured on a libuv threadpool
  // thread of the root process — never in the root pid's own file. So the root side is the root pid's whole
  // thread group: the root pid plus every task a member of the group created with CLONE_THREAD, transitively
  // (the `clone`/`clone3` lines, real capture shapes from `strace 6.8 -ff` of a vitest run).
  const thread = (tid: number) =>
    `clone3({flags=CLONE_VM|CLONE_FS|CLONE_FILES|CLONE_SIGHAND|CLONE_THREAD|CLONE_SYSVSEM|CLONE_SETTLS|CLONE_PARENT_SETTID|CLONE_CHILD_CLEARTID, child_tid=0x78544ddfe990, parent_tid=0x78544ddfe990, exit_signal=0, stack=0x78544d5fe000, stack_size=0x7ffe80, tls=0x78544ddfe6c0} => {parent_tid=[${tid}]}, 88) = ${tid}`;
  const child = (pid: number) =>
    `clone(child_stack=NULL, flags=CLONE_CHILD_CLEARTID|CLONE_CHILD_SETTID|SIGCHLD, child_tidptr=0x78544e8cdfd0) = ${pid}`;

  it('the root pid and every thread its process creates are root; every other process (and its threads) is rest', () => {
    const dir = traceDirWith({
      't.500': [ // the root process's main thread: the config, one thread, one child process
        thread(1000),
        child(501),
        `openat(AT_FDCWD<${REPO}/server>, "${REPO}/server/vitest.config.ts", O_RDONLY|O_CLOEXEC) = 21<${REPO}/server/vitest.config.ts>`,
      ].join('\n') + '\n',
      // `t.1000` sorts BEFORE `t.500`, so the grandchild thread's edge is seen before its creator joins the group
      // — the closure has to go round again, as it does when real tids cross a digit boundary.
      't.1000': [ // a root threadpool thread: the include glob's walk, and a thread of its own
        thread(1001),
        `getdents64(20<${REPO}/server/test>, 0x7df18c000ba0 /* 401 entries */, 32768) = 18048`,
      ].join('\n') + '\n',
      't.1001': [ // a thread created BY a root thread: still the root process
        `openat(AT_FDCWD<${REPO}/server>, "${REPO}/server/tsconfig.json", O_RDONLY|O_CLOEXEC) = 22<${REPO}/server/tsconfig.json>`,
      ].join('\n') + '\n',
      't.501': [ // the test's worker process: its own walk of server/test, and a thread
        thread(520),
        `getdents64(22<${REPO}/server/test>, 0x7df18c000ba0 /* 401 entries */, 32768) = 18048`,
        `openat(AT_FDCWD<${REPO}/server>, "${REPO}/ccd/ccd", O_RDONLY) = 3<${REPO}/ccd/ccd>`,
      ].join('\n') + '\n',
      't.520': [ // the worker's thread: rest, like the worker
        `openat(AT_FDCWD<${REPO}>, "${REPO}/shared/api.ts", O_RDONLY) = 3<${REPO}/shared/api.ts>`,
      ].join('\n') + '\n',
      't.502': [ // a git the test spawned
        `openat(AT_FDCWD<${REPO}>, "${REPO}/package.json", O_RDONLY) = 3<${REPO}/package.json>`,
        `access(".git/config", R_OK) = 0`,
      ].join('\n') + '\n',
    });
    const { root, rest, unresolved } = parseTraceDirSplit(dir, REPO, 500);
    expect(root).toEqual({
      read: ['server/tsconfig.json', 'server/vitest.config.ts'], probed: [], listed: ['server/test'], subtree: [], git: false,
    });
    expect(rest).toEqual({
      read: ['ccd/ccd', 'package.json', 'shared/api.ts'], probed: [], listed: ['server/test'], subtree: [], git: true,
    });
    expect(unresolved).toBe(0);
  });

  it('a root pid with no file leaves root empty, and unresolved counts both sides', () => {
    const dir = traceDirWith({
      't.600': [`access("some-relative-file", F_OK) = 0`].join('\n') + '\n',
      't.601': [`access("another-relative-file", F_OK) = 0`].join('\n') + '\n',
    });
    const split = parseTraceDirSplit(dir, REPO, 600);
    expect(split.unresolved).toBe(2);
    const none = parseTraceDirSplit(dir, REPO, 999);
    expect(none.root).toEqual({ read: [], probed: [], listed: [], subtree: [], git: false });
  });
});

describe('parseTraceDirDetailed', () => {
  it('returns unresolved: 0 for a clean trace', () => {
    const dir = traceDirWith({
      't.14001': [
        `openat(AT_FDCWD<${REPO}/server>, "${REPO}/server/test/bus.test.ts", O_RDONLY) = 3<${REPO}/server/test/bus.test.ts>`,
      ].join('\n') + '\n',
    });
    const { unresolved } = parseTraceDirDetailed(dir, REPO);
    expect(unresolved).toBe(0);
  });
});
