// CI test selection (spec §5.1-5.2, contract Task 3): parses `strace -f -ff -ttt -y -qq` output for one server
// test file — one file per thread, as `trace-run.mjs`'s `traceArgv` produces — into a repo-relative `DepRecord`.
//
// `-y` is what makes this parser possible without tracking file descriptors by hand: it prints, inline on every
// syscall that takes a directory-fd or plain fd argument, that fd's OWN resolved path in `<...>` — `AT_FDCWD<cwd>`
// for the process's current directory, `N<path>` for a numbered fd. A relative path argument on a syscall that
// carries its own dirfd (`openat`, `openat2`, `newfstatat`, `statx`, `faccessat2`, `readlinkat`, `execveat`,
// `getdents64`) is therefore always resolvable from that SAME line — no fd bookkeeping needed. Only the
// syscalls with no dirfd argument at all (`open`, `access`, `readlink`, `symlink`, `execve`) can carry a relative
// path with nothing on the line to resolve it against. Those use the PROCESS's cwd AT THAT MOMENT — the whole
// thread group's, since threads share one. Every line carries a `-ttt` timestamp and `chdir`/`fchdir` are traced,
// so a process's events, across all its threads' files, are replayed in time order: an `AT_FDCWD<...>` annotation
// says what the cwd is, a successful `chdir`/`fchdir` moves it. A relative path with no known cwd at its moment is
// counted `unresolved`, which makes the record `unknown` — and so is one in the SAME microsecond as a move of the
// cwd, which the stamp cannot order (measured on nine real traces: it left nothing unresolved). Measured why the time order is needed: git chdirs to
// the work tree before `access(".git/config")`, so a rule that gave up on any process that chdir'd left
// worker-skill, ccd-account-ok and session-hook unknown (45, 318 and 8256 unresolved paths); and the older
// per-file "last cwd seen" rule joined such a path to the STALE cwd (after `process.chdir('<repo>/ccd')`,
// `fs.existsSync('x')` issues a bare `access` it recorded as `server/x`). `execve` is exempt entirely: a relative
// `execve` is deliberately ignored (never resolved, never counted `unresolved`) because the *interpreter's* own
// `openat` of that same script records the dependency a moment later.
//
// Reads THROUGH a symlink: a successful `open`/`openat`/`openat2` prints the new fd's RESOLVED path after `=`
// (`= 3</repo/ccd/f>`), and that path is recorded as well as the argument — ccrc-models and its siblings symlink
// repo files into a tmp HOME and run them there, where the argument path is outside the repo. And a created
// symlink (`symlink`/`symlinkat`) whose TARGET is in the repo — a relative target resolved against the link's own
// directory — records that target, because what the test later only stats or probes through the link returns no
// fd and so no resolved path: a FILE target is `read`, and a DIRECTORY target is `subtree` (a fixture home that
// links `deploy/` or `shared/` whole, then stats `…/deploy/x` — measured: the stat's argument is outside the repo
// and nothing else names `deploy/x`). Which of the two is decided by `statSync` on the target when the trace is
// PARSED — trace-run parses in the checkout it traced, so the tree is the one the test ran against; a target that
// is not there (dangling) stays `read`. A `subtree` directory selects the test for any change at or under it
// (select-tests.mjs rule 6).
//
// Only a successful call or one that failed with ENOENT is ever recorded. Any other failure (EACCES, ENOTDIR, a
// signal-interrupted call, …) is silently skipped: it is neither "this test's behaviour depends on this path's
// CONTENT" (that needs a successful read) nor "this test's behaviour depends on this path's EXISTENCE" (that is
// what ENOENT — a currently-absent path — means; some other error says nothing about whether adding the path
// would change anything). One exception: `readlink` failing with EINVAL is recorded as `read` — the path EXISTS,
// it just is not a symlink — because a test that only realpaths a file still depends on that file existing.
//
// `readlink` is in the trace list because `fs.realpathSync.native` probes a path with it and nothing else
// (measured: `realpathSync.native('missing/x')` emits ONLY `readlink("…/missing", …) = -1 ENOENT`), so without it
// that probe would be invisible. It is parsed like `access`: success -> read, ENOENT -> probed — and EINVAL ->
// read (see above).
//
// A trace is also read SPLIT BY PROCESS (`parseTraceDirSplit`): the vitest ROOT process — the one that loads the
// config and walks the `include` glob, so lists `server/test/` for every test — apart from every other process
// (the test's worker and whatever it spawns). The baseline is then subtracted per side (`testmap.mjs`), which
// removes the glob's walk of `server/test/` without also erasing a test's OWN walk of the same directory
// (`single-definition`'s census reads every test file). Subtracting a single merged record could not tell those
// two listings apart. `-ff` writes one file per THREAD, and the glob's walk was measured on a libuv threadpool
// thread of the root process, never in the root pid's own file — so the root side is the root pid's whole thread
// group, rebuilt from the `clone`/`clone3` lines (traced for exactly this): every task a member of the group
// created with `CLONE_THREAD` is in the group too.
import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** @typedef {{ read: string[], probed: string[], listed: string[], subtree: string[], git: boolean }} DepRecord */

// The dirfd/fd annotation `-y` prints: `AT_FDCWD<...>` or a bare fd number `<...>`, always present on a syscall
// that takes one, in both success and failure lines.
const FD_ANNOTATION = /^(?:AT_FDCWD|\d+)<([^>]*)>$/;

// Syscalls whose first argument is a dirfd (or AT_FDCWD) and whose second argument is the path: a relative path
// is always resolvable from this same line's dirfd annotation. The last group is the resolved path `-y` prints
// after a successful call's returned fd (`= 3</path>`), for the calls that return one.
const DIRFD_PATH_RE =
  /^(openat|openat2|newfstatat|statx|faccessat2|readlinkat|execveat)\(((?:AT_FDCWD|\d+)<[^>]*>), "((?:[^"\\]|\\.)*)"[^)]*\)\s*=\s*(-1\s+\S+|\d+)(?:<([^>]*)>)?/;

// Syscalls with no dirfd argument at all: the path is either absolute, or relative to the process's cwd
// (`open`/`access`) or ignored entirely when relative (`execve`).
const BARE_PATH_RE = /^(open|access|execve)\("((?:[^"\\]|\\.)*)"[^)]*\)\s*=\s*(-1\s+\S+|\d+)(?:<([^>]*)>)?/;

// `symlink(target, linkpath)` (node's fs.symlinkSync) and `symlinkat(target, newdirfd, linkpath)` (coreutils
// `ln -s`), both measured. Only a successful creation is recorded.
const SYMLINK_RE = /^symlink\("((?:[^"\\]|\\.)*)", "((?:[^"\\]|\\.)*)"\)\s*=\s*(-1\s+\S+|\d+)/;
const SYMLINKAT_RE =
  /^symlinkat\("((?:[^"\\]|\\.)*)", ((?:AT_FDCWD|\d+)<[^>]*>), "((?:[^"\\]|\\.)*)"\)\s*=\s*(-1\s+\S+|\d+)/;

// A successful `chdir("path")` / `fchdir(N<dir>)`: the process's cwd moved.
const CHDIR_RE = /^chdir\("((?:[^"\\]|\\.)*)"\)\s*=\s*0\s*$/;
const FCHDIR_RE = /^fchdir\(\d+<([^>]*)>\)\s*=\s*0\s*$/;

// `-ttt`'s prefix: seconds and microseconds since the epoch.
const TS_RE = /^(\d+)\.(\d{6}) /;

// `readlink(path, buf, size)` — no dirfd either, so a relative path resolves against the pid's cwd exactly like
// `access`. Its second argument is the link's TARGET, printed as a string that may itself contain `)`, so the
// result is matched from the END of the line rather than after the first `)`.
const READLINK_RE = /^readlink\("((?:[^"\\]|\\.)*)", .*\)\s*=\s*(-1\s+\S+|\d+)(?:\s+\([^()]*\))?\s*$/;

// `getdents64(fd<dir>, buf, size) = bytes` — the only syscall in scope with no path argument at all: what is
// enumerated is the fd's own resolved directory.
const GETDENTS_RE = /^getdents64\((\d+<[^>]*>|AT_FDCWD<[^>]*>)/;

// `clone(…) = <tid>` / `clone3({flags=…}, …) = <tid>` in the CREATING task's file. A task created with
// `CLONE_THREAD` is a thread of the creator's process; anything else is a new process.
const CLONE_RE = /^clone3?\((.*)\)\s*=\s*([1-9]\d*)\s*$/;

/** Classifies an absolute, already-normalized path against the repo root: outside the repo or under a
 *  `node_modules` segment -> dropped; under `<root>/.git` (or equal to it) -> `{ kind: 'git' }`; otherwise
 *  `{ kind: 'in', rel }` with `rel` POSIX repo-relative (`'.'` for the root itself). */
function classify(absPath, root) {
  let rel;
  if (absPath === root) rel = '.';
  else if (absPath.startsWith(root + '/')) rel = absPath.slice(root.length + 1);
  else return { kind: 'drop' };
  const segments = rel.split('/');
  if (segments.includes('node_modules')) return { kind: 'drop' };
  if (rel === '.git' || segments[0] === '.git') return { kind: 'git' };
  return { kind: 'in', rel };
}

function isSuccess(result) {
  return /^\d+$/.test(result);
}

function isEinval(result) {
  return /^-1\s+EINVAL\b/.test(result);
}

function isEnoent(result) {
  return /^-1\s+ENOENT\b/.test(result);
}

/** @typedef {{ key: number, line: string }} Entry  one trace line, its `-ttt` prefix stripped into `key` */

/** Parses one pid's trace entries, folding its findings into `sink` (mutable Sets/flag holder). `cwdAt(key)` is
 *  the process's cwd at that moment, or `undefined` when it is not known (see the file header). */
function parsePidFile(entries, root, sink, cwdAt) {
  let entryKey = 0;

  /** A dirfd-less relative path, absolute when the process's cwd at this line is known; else unresolved. */
  const relative = (rawPath) => {
    const cwd = cwdAt(entryKey);
    if (cwd === undefined) {
      sink.unresolved.value += 1;
      return null;
    }
    return path.posix.join(cwd, rawPath);
  };

  const record = (rel, bucket) => {
    if (bucket === 'read') sink.read.add(rel);
    else if (bucket === 'probed') sink.probed.add(rel);
    else if (bucket === 'listed') sink.listed.add(rel);
    else if (bucket === 'subtree') sink.subtree.add(rel);
    else if (bucket === 'git') sink.git.value = true;
  };

  /** A created link's in-repo target: `subtree` when it is a directory on disk now (the checkout this trace ran
   *  in), else `read` — a file, or a target that is not there (dangling). */
  const recordLinkTarget = (absTarget) => {
    const normalized = path.posix.normalize(absTarget).replace(/\/+$/, '') || '/';
    let isDir = false;
    try {
      isDir = statSync(normalized).isDirectory();
    } catch {
      isDir = false;
    }
    classifyAndRecord(normalized, isDir ? 'subtree' : 'read');
  };

  const classifyAndRecord = (absPath, bucket) => {
    // A real argument path can carry a trailing slash (Node opens a directory as `"…/test/"`) while strace's OWN
    // `<resolved>` return annotation for the same fd never does -- left alone, the two spellings of one
    // directory would dedupe as two different record entries (measured against a real trace, `server/test` vs
    // `server/test/`). Stripped here, once, for every path this function ever records.
    const normalized = path.posix.normalize(absPath).replace(/\/+$/, '') || '/';
    const c = classify(normalized, root);
    if (c.kind === 'drop') return;
    if (c.kind === 'git') {
      if (bucket !== 'listed') record(null, 'git'); // any read/probe under .git -> the git flag, never a path
      else record(null, 'git'); // a directory listing under .git counts too
      return;
    }
    record(c.rel, bucket);
  };

  for (const { key, line } of entries) {
    entryKey = key;
    // getdents64 first: its regex is a prefix of no other pattern, cheap to check early.
    const gd = line.match(GETDENTS_RE);
    if (gd) {
      const fdAnnot = gd[1].match(FD_ANNOTATION);
      const resultMatch = line.match(/\)\s*=\s*(-1\s+\S+|\d+)\s*$/);
      if (fdAnnot && resultMatch && isSuccess(resultMatch[1])) {
        classifyAndRecord(fdAnnot[1], 'listed');
      }
      continue;
    }

    const df = line.match(DIRFD_PATH_RE);
    if (df) {
      const [, , dirfdRaw, rawPath, result, resolved] = df;
      const success = isSuccess(result);
      const enoent = isEnoent(result);
      if (success || enoent) {
        let abs;
        if (rawPath.startsWith('/')) {
          abs = rawPath;
        } else {
          const dm = dirfdRaw.match(FD_ANNOTATION);
          abs = dm ? path.posix.join(dm[1], rawPath) : null;
        }
        if (abs !== null) classifyAndRecord(abs, success ? 'read' : 'probed');
        // The fd's resolved path: where a symlinked argument really led.
        if (success && resolved !== undefined && resolved.startsWith('/')) classifyAndRecord(resolved, 'read');
      }
      continue;
    }

    const bp = line.match(BARE_PATH_RE);
    const rl = bp ? null : line.match(READLINK_RE);
    if (bp || rl) {
      const [name, rawPath, result, resolved] = bp ? [bp[1], bp[2], bp[3], bp[4]] : ['readlink', rl[1], rl[2], undefined];
      // readlink's EINVAL: the path exists and is not a symlink — a read, as far as existence goes.
      const success = isSuccess(result) || (name === 'readlink' && isEinval(result));
      const enoent = isEnoent(result);
      if (success || enoent) {
        if (rawPath.startsWith('/')) {
          classifyAndRecord(rawPath, success ? 'read' : 'probed');
        } else if (name === 'execve') {
          // Relative execve: deliberately ignored, never unresolved (see file header).
        } else {
          const abs = relative(rawPath);
          if (abs !== null) classifyAndRecord(abs, success ? 'read' : 'probed');
        }
        if (success && resolved !== undefined && resolved.startsWith('/')) classifyAndRecord(resolved, 'read');
      }
      continue;
    }

    const sl = line.match(SYMLINK_RE);
    const sla = sl ? null : line.match(SYMLINKAT_RE);
    if (sl || sla) {
      const [target, linkDirOf, result] = sl
        // symlink(target, linkpath): the link's directory from the linkpath (dirfd-less when relative).
        ? [sl[1], () => (sl[2].startsWith('/') ? sl[2] : relative(sl[2])), sl[3]]
        // symlinkat(target, newdirfd, linkpath): relative to the dirfd's annotation.
        : [sla[1], () => {
          if (sla[3].startsWith('/')) return sla[3];
          const dm = sla[2].match(FD_ANNOTATION);
          return dm ? path.posix.join(dm[1], sla[3]) : null;
        }, sla[4]];
      if (isSuccess(result)) {
        if (target.startsWith('/')) {
          recordLinkTarget(target);
        } else {
          const link = linkDirOf();
          if (link !== null) recordLinkTarget(path.posix.join(path.posix.dirname(link), target));
        }
      }
      continue;
    }
  }
}

function newSink() {
  return {
    read: new Set(),
    probed: new Set(),
    listed: new Set(),
    subtree: new Set(),
    git: { value: false },
    unresolved: { value: 0 },
  };
}

/** @returns {DepRecord} */
function sinkRecord(sink) {
  return {
    read: [...sink.read].sort(),
    probed: [...sink.probed].sort(),
    listed: [...sink.listed].sort(),
    subtree: [...sink.subtree].sort(),
    git: sink.git.value,
  };
}

/** Every readable pid file in `traceDir`, as `[fileName, entries]`, in name order. An entry's `key` orders it in
 *  time: the `-ttt` stamp in microseconds, or — for a line with none — a sequence number, so lines without
 *  stamps keep file order (file after file, in name order).
 *  @returns {Array<[string, Entry[]]>} */
function readPidFiles(traceDir) {
  /** @type {Array<[string, Entry[]]>} */
  const out = [];
  let seq = 0;
  for (const file of readdirSync(traceDir).sort()) {
    let text;
    try {
      text = readFileSync(path.join(traceDir, file), 'utf8');
    } catch {
      continue;
    }
    out.push([file, text.split('\n').map((raw) => {
      const m = raw.match(TS_RE);
      seq += 1;
      return m ? { key: Number(m[1]) * 1e6 + Number(m[2]), line: raw.slice(m[0].length) } : { key: seq, line: raw };
    })]);
  }
  return out;
}

/** The pid files of `rootPid`'s thread group: `t.<rootPid>` plus the file of every task a member created with
 *  `CLONE_THREAD`, transitively (a thread of a thread is still a thread of the process).
 *  @param {Array<[string, string]>} pidFiles @param {number|string} rootPid @returns {Set<string>} */
function threadGroupFiles(pidFiles, rootPid) {
  /** @type {Array<[string, string]>} */
  const threadEdges = [];
  for (const [file, entries] of pidFiles) {
    for (const { line } of entries) {
      const m = line.match(CLONE_RE);
      if (m && /\bCLONE_THREAD\b/.test(m[1])) threadEdges.push([file, `t.${m[2]}`]);
    }
  }
  const group = new Set([`t.${rootPid}`]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const [creator, created] of threadEdges) {
      if (group.has(creator) && !group.has(created)) {
        group.add(created);
        grew = true;
      }
    }
  }
  return group;
}

/** For every pid file, `cwdAt(key)`: its process's cwd at that moment, or `undefined` when unknown. The files are
 *  grouped into processes by their `CLONE_THREAD` clones (threads share one cwd); a process's cwd events —
 *  `AT_FDCWD<…>` annotations, successful `chdir`/`fchdir` — are replayed in time order. Before its first move the
 *  cwd is the one its annotations name (unknown if they disagree: the cwd moved untraced); after a move it is
 *  wherever the moves and later annotations put it.
 *  @param {Array<[string, Entry[]]>} pidFiles @returns {Map<string, (key: number) => string | undefined>} */
function processCwds(pidFiles) {
  /** @type {Map<string, string>} */
  const parent = new Map(pidFiles.map(([file]) => [file, file]));
  const find = (f) => {
    while (parent.get(f) !== f) f = /** @type {string} */ (parent.get(f));
    return f;
  };
  for (const [file, entries] of pidFiles) {
    for (const { line } of entries) {
      const m = line.match(CLONE_RE);
      if (m && /\bCLONE_THREAD\b/.test(m[1])) {
        const created = `t.${m[2]}`;
        if (parent.has(created)) parent.set(find(created), find(file));
      }
    }
  }
  /** @type {Map<string, Array<{ key: number, kind: 'at'|'chdir'|'fchdir', dir: string }>>} */
  const events = new Map();
  for (const [file, entries] of pidFiles) {
    const g = find(file);
    if (!events.has(g)) events.set(g, []);
    const list = /** @type {Array<{ key: number, kind: 'at'|'chdir'|'fchdir', dir: string }>} */ (events.get(g));
    for (const { key, line } of entries) {
      const cd = line.match(CHDIR_RE);
      const fcd = cd ? null : line.match(FCHDIR_RE);
      if (cd) list.push({ key, kind: 'chdir', dir: cd[1] });
      else if (fcd) list.push({ key, kind: 'fchdir', dir: fcd[1] });
      else for (const a of line.matchAll(/AT_FDCWD<([^>]*)>/g)) list.push({ key, kind: 'at', dir: a[1] });
    }
  }
  /** @type {Map<string, (key: number) => string | undefined>} */
  const byGroup = new Map();
  for (const [g, list] of events) {
    list.sort((a, b) => a.key - b.key);
    const firstMove = list.findIndex((e) => e.kind !== 'at');
    const before = new Set(list.slice(0, firstMove === -1 ? list.length : firstMove).map((e) => e.dir));
    const initial = before.size === 1 ? [...before][0] : undefined;
    /** @type {Array<{ key: number, cwd: string | undefined }>} */
    const after = [];
    let cwd = initial;
    for (const e of firstMove === -1 ? [] : list.slice(firstMove)) {
      if (e.kind === 'at' || e.kind === 'fchdir') cwd = e.dir;
      else cwd = e.dir.startsWith('/') ? path.posix.normalize(e.dir) : cwd === undefined ? undefined : path.posix.join(cwd, e.dir);
      after.push({ key: e.key, cwd });
    }
    /** The cwd after every event stamped at or before `key`. */
    const at = (key) => {
      let lo = 0;
      let hi = after.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (after[mid].key <= key) lo = mid + 1;
        else hi = mid;
      }
      return lo === 0 ? initial : after[lo - 1].cwd;
    };
    // A call stamped in the same microsecond as a move cannot be ordered against it: unknown, unless the move
    // left the cwd where it was. (A line with no stamp has a unique sequence key, so it never ties.)
    byGroup.set(g, (key) => {
      const now = at(key);
      return at(key - 1) === now ? now : undefined;
    });
  }
  /** @type {Map<string, (key: number) => string | undefined>} */
  const out = new Map();
  for (const [file] of pidFiles) out.set(file, /** @type {(key: number) => string | undefined} */ (byGroup.get(find(file))));
  return out;
}

/**
 * Parses every trace file in `traceDir` (one per pid, `strace -ff` output) and merges them into one `DepRecord`,
 * plus the count of relative paths that could not be resolved to any cwd (a test with `unresolved > 0` should be
 * marked `unknown` by the caller — see `trace-run.mjs`).
 * @param {string} traceDir
 * @param {string} repoRoot
 * @returns {{ record: DepRecord, unresolved: number }}
 */
export function parseTraceDirDetailed(traceDir, repoRoot) {
  const root = realpathSync(repoRoot).replace(/\/+$/, '');
  const sink = newSink();
  const pidFiles = readPidFiles(traceDir);
  const cwds = processCwds(pidFiles);
  for (const [file, entries] of pidFiles) parsePidFile(entries, root, sink, /** @type {(key: number) => string | undefined} */ (cwds.get(file)));
  return { record: sinkRecord(sink), unresolved: sink.unresolved.value };
}

/**
 * The same parse, split by process: `root` is the vitest root process — `rootPid`, which `trace-run.mjs`
 * captures, and every thread of it (see the file header) — and `rest` is every other process. A root pid with no
 * file leaves `root` empty; the caller checks that the file exists before trusting the split.
 * @param {string} traceDir
 * @param {string} repoRoot
 * @param {number|string} rootPid
 * @returns {{ root: DepRecord, rest: DepRecord, unresolved: number }}
 */
export function parseTraceDirSplit(traceDir, repoRoot, rootPid) {
  const root = realpathSync(repoRoot).replace(/\/+$/, '');
  const pidFiles = readPidFiles(traceDir);
  const group = threadGroupFiles(pidFiles, rootPid);
  const cwds = processCwds(pidFiles);
  const rootSink = newSink();
  const restSink = newSink();
  for (const [file, entries] of pidFiles) {
    parsePidFile(entries, root, group.has(file) ? rootSink : restSink, /** @type {(key: number) => string | undefined} */ (cwds.get(file)));
  }
  return {
    root: sinkRecord(rootSink),
    rest: sinkRecord(restSink),
    unresolved: rootSink.unresolved.value + restSink.unresolved.value,
  };
}

/**
 * @param {string} traceDir
 * @param {string} repoRoot
 * @returns {DepRecord}
 */
export function parseTraceDir(traceDir, repoRoot) {
  return parseTraceDirDetailed(traceDir, repoRoot).record;
}

function main() {
  const [traceDir, repoRoot] = process.argv.slice(2);
  if (!traceDir || !repoRoot) {
    process.stderr.write('usage: node trace-to-deps.mjs <traceDir> <repoRoot>\n');
    process.exit(2);
  }
  const rec = parseTraceDir(traceDir, repoRoot);
  process.stdout.write(JSON.stringify(rec) + '\n');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
