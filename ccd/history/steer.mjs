// ccd/history/steer.mjs: the steer file's IO (spec 2026-10-05 §7.1, §7.7, §9.4; W3 plan Task 1B).
//
// L3 adapters, and nothing else. The card step (card.mjs) measures, lib.mjs decides (decideCardFile with artifact 'steer',
// composeSteerFile), and this module only reads a file, reads the previous leaf's stored row, and writes a file. It decides
// nothing: whether a steer file is written, kept, consumed or withdrawn is the card's lifecycle, applied by card.mjs.
import { closeSync, constants, fstatSync, openSync, readSync } from 'node:fs';
import { HISTORY_NODE_ID_RE, NODE_KINDS, PARSE_STATUS, STEER_FILE_MAX, nodeRangeText } from './lib.mjs';
import { writeFileAtomic } from './store.mjs';

/** A steer file as a Presence, as card.mjs's readCard answers one: absent (ENOENT); unreadable (any other failure, a file
 *  that is not a regular file (a link, a FIFO or a directory is never read), or one longer than STEER_FILE_MAX bytes, which
 *  this writer never makes and the hook refuses); or its text. The read is an `O_NOFOLLOW | O_NONBLOCK` open, an `fstat`
 *  type check and at most STEER_FILE_MAX + 1 bytes. */
export function readSteerFile(path) {
  let fd;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (e) {
    return e && e.code === 'ENOENT' ? { state: 'absent' } : { state: 'unreadable' };
  }
  try {
    if (!fstatSync(fd).isFile()) return { state: 'unreadable' };
    const buf = Buffer.alloc(STEER_FILE_MAX + 1);
    const n = readSync(fd, buf, 0, buf.length, 0);
    if (n > STEER_FILE_MAX) return { state: 'unreadable' };
    return { state: 'value', value: buf.subarray(0, n).toString('utf8') };
  } catch {
    return { state: 'unreadable' };
  } finally {
    closeSync(fd);
  }
}

const PREV_STMTS = new WeakMap();

function prevStmt(db) {
  let s = PREV_STMTS.get(db);
  if (s === undefined) {
    // The epoch's level-0 nodes whose boundary is a member of THIS copy, newest boundary (by line in the copy) first.
    s = db.prepare(`SELECT n.node_id AS node_id, n.kind AS kind, n.status AS status, n.gist AS gist,
        n.earliest_ms AS earliest_ms, n.latest_ms AS latest_ms, n.directive_flag AS directive_flag
      FROM nodes n JOIN memberships m ON m.entry_id = n.boundary_entry_id AND m.file_id = ?
      WHERE n.session_pk = ? AND n.epoch_seq = ? AND n.depth = 0
      ORDER BY m.line DESC LIMIT 1`);
    PREV_STMTS.set(db, s);
  }
  return s;
}

const finiteOrNull = (v) => v === null || (typeof v === 'number' && Number.isFinite(v));

/** The epoch's newest level-0 node of one copy, as composeSteerFile's `prev`, or null when the copy has none (nothing to
 *  quote). `epoch` is derive.mjs's epochOfUuid answer (`session_pk`, `seq`). The stored `directive_flag` maps by the closed
 *  rule: 0 is flag false, 1 is flag true, anything else is unreadable. A row that cannot be read answers `status: 'unreadable'`,
 *  which composeSteerFile quotes nothing for, and never throws through the card step:
 *    - a `node_id` off the node grammar (`^[LN][0-9a-f]{20}$`);
 *    - a kind outside lib's node kinds, or a status outside lib's status words;
 *    - an instant that is neither null nor a finite number, or one `nodeRangeText` cannot spell (out of the date range);
 *    - a `directive_flag` that is neither 0 nor 1;
 *    - a steered leaf with a `gist` that is not text;
 *    - a read of the row that fails (the store's own error). */
export function prevLeafOf(db, copyFileId, epoch) {
  let row;
  try {
    row = prevStmt(db).get(copyFileId, epoch.session_pk, epoch.seq);
  } catch {
    return unreadablePrev(null);
  }
  if (row === undefined) return null;
  if (typeof row.node_id !== 'string' || !HISTORY_NODE_ID_RE.test(row.node_id)) return unreadablePrev(null);
  if (!NODE_KINDS.includes(row.kind) || !PARSE_STATUS.includes(row.status)) return unreadablePrev(row.node_id);
  if (row.directive_flag !== 0 && row.directive_flag !== 1) return unreadablePrev(row.node_id);
  if (!finiteOrNull(row.earliest_ms) || !finiteOrNull(row.latest_ms)) return unreadablePrev(row.node_id);
  let range;
  try {
    range = nodeRangeText(row.earliest_ms, row.latest_ms);
  } catch {
    return unreadablePrev(row.node_id);
  }
  if (typeof row.gist !== 'string' && row.kind === 'steered_leaf' && row.status === 'ok') return unreadablePrev(row.node_id);
  return {
    id: row.node_id, range, kind: row.kind, status: row.status, gist: typeof row.gist === 'string' ? row.gist : '',
    flag: row.directive_flag === 1,
  };
}

function unreadablePrev(id) {
  return { id: id ?? '', range: '', kind: '', status: 'unreadable', gist: '', flag: false };
}

/** The steer file, whole: `text` and one LF, 0600, by `writeFileAtomic`'s temp and rename. The caller made the directory
 *  and checked it is no link; a failure throws, as the card's write does, and the caller counts it. */
export function writeSteerFile(file, text) {
  writeFileAtomic(file, `${text}\n`, 0o600);
}
