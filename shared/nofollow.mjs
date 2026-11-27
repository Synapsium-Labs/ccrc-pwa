// shared/nofollow.mjs -- open a path without following a symbolic link at its last component, said once for every
// writer and reader that refuses a link (the server's append-only journals, the collect-lane journal, the operator's
// secret store, the history card and CLI reads).
//
// POSIX has O_NOFOLLOW, and the open itself refuses a link with ELOOP. Windows has none: `constants.O_NOFOLLOW` is
// undefined there and ORs in as 0, so the refusal silently disappeared (as O_NONBLOCK and O_DIRECTORY do; neither
// guards a link). Here `O_NOFOLLOW` is the platform's flag, or on Windows a marker bit that this module's `openSync` and
// `open` read and strip (never passed to the OS; libuv ignores the bit anyway). With the marker, the path is `lstat`ed
// before the open (a link, a junction included, is refused with ELOOP), and the opened descriptor's `fstat` must name
// the same file (dev and ino, as bigints) as that `lstat`, so a link swapped in between the two is refused too. A path
// the open CREATES (absent at the `lstat`) is `lstat`ed again after the open and must be that same file, not a link.
// The idea is deploy/coordination-snapshot.mjs's `openNoFollow` (lstat before open), made whole; that file keeps its
// own copy because it imports node: modules only.
//
// Off Windows `O_NOFOLLOW` is `constants.O_NOFOLLOW` and `openSync`/`open` ARE node's: nothing changes there.
import { closeSync, constants, fstatSync, lstatSync, openSync as nodeOpenSync, promises as fsp } from 'node:fs';

const NATIVE = constants.O_NOFOLLOW !== undefined;
/** Windows' marker: a bit no Windows open flag uses (libuv's are below 0x40000000). */
const MARK = 0x40000000;

/** The flag an open ORs in to refuse a link at the last component: the platform's, or Windows' marker. Pass it only
 *  to this module's `openSync`/`open`. */
export const O_NOFOLLOW = NATIVE ? constants.O_NOFOLLOW : MARK;

const eloop = (p) => Object.assign(new Error(`ELOOP: too many symbolic links encountered, open '${p}'`), { code: 'ELOOP', syscall: 'open', path: p });
const same = (a, b) => a.dev === b.dev && a.ino === b.ino;

/** The `lstat` before the open: the file, or null for an absent path the open may create; a link throws ELOOP. */
function before(p, flags) {
  let st;
  try { st = lstatSync(p, { bigint: true }); } catch (e) {
    if (e?.code === 'ENOENT' && (flags & constants.O_CREAT) !== 0) return null;
    throw e;
  }
  if (st.isSymbolicLink()) throw eloop(p);
  return st;
}

/** The check after the open, against the descriptor's own `fstat`. */
function after(p, was, opened) {
  const now = was ?? lstatSync(p, { bigint: true });
  if (now.isSymbolicLink() || !same(now, opened)) throw eloop(p);
}

/** `fs.openSync`, with `O_NOFOLLOW` honoured on Windows too. */
export function openSync(p, flags, mode) {
  if (NATIVE || (flags & MARK) === 0) return nodeOpenSync(p, flags, mode);
  const bare = flags & ~MARK;
  const was = before(p, bare);
  const fd = nodeOpenSync(p, bare, mode);
  try { after(p, was, fstatSync(fd, { bigint: true })); } catch (e) { closeSync(fd); throw e; }
  return fd;
}

/** `fs.promises.open`, with `O_NOFOLLOW` honoured on Windows too. */
export async function open(p, flags, mode) {
  if (NATIVE || (flags & MARK) === 0) return fsp.open(p, flags, mode);
  const bare = flags & ~MARK;
  const was = before(p, bare);
  const fh = await fsp.open(p, bare, mode);
  try { after(p, was, await fh.stat({ bigint: true })); } catch (e) { await fh.close().catch(() => {}); throw e; }
  return fh;
}
