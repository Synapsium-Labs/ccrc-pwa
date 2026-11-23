// The ONE measurer of a host's identity (Overlord W1, spec 2026-11-09 §7.4, H28; plan `w1-isolation.md` Task 1, question
// 13, slug `host-identity-is-two-keyed-digests`). The agent reads its own ids here and sends only their keyed digests on
// every ready; the server reads its own ids here, keeps them in memory, and digests them under the same bearer to compare.
//
// L0 `.mjs`, context K. It imports `node:crypto` and `node:fs` only (the `.mjs` carve-out,
// `server/test/rings/mjs-node.data.ts#MJS_CARVE_OUT`). Types live alongside in the hand-written
// `shared/host-identity.d.mts`. Nothing here logs or throws: a raw id never leaves the measuring process's memory.
import { createHmac } from 'node:crypto';
import { closeSync, openSync, readSync } from 'node:fs';

const MACHINE_ID_RE = /^[0-9a-f]{32}$/;
const BOOT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Both files are one short line; anything longer than this is not one of them. */
const ID_READ_MAX = 128;

/** Read at most `ID_READ_MAX` bytes of `file`, or `null` on any failure. */
function readSmall(file) {
  let fd;
  try {
    fd = openSync(file, 'r');
    const buf = Buffer.alloc(ID_READ_MAX + 1);
    const n = readSync(fd, buf, 0, buf.length, 0);
    return n > ID_READ_MAX ? null : buf.subarray(0, n).toString('utf8');
  } catch {
    return null;
  } finally {
    if (fd !== undefined) { try { closeSync(fd); } catch { /* nothing to report */ } }
  }
}

function readId(file, re) {
  const text = readSmall(file);
  if (text === null) return 'unmeasured';
  const v = text.trim();
  return re.test(v) ? v : 'unmeasured';
}

/** Reads `<etcRoot>/machine-id` (32 lowercase hex) and `<procRoot>/sys/kernel/random/boot_id` (a UUID). Off Linux, or on
 *  any read or parse failure, that id is `'unmeasured'`. Never throws, never logs. */
export function readHostIds(roots = {}) {
  const procRoot = roots.procRoot ?? '/proc';
  const etcRoot = roots.etcRoot ?? '/etc';
  const platform = roots.platform ?? process.platform;
  if (platform !== 'linux') return { machine: 'unmeasured', boot: 'unmeasured' };
  return {
    machine: readId(`${etcRoot}/machine-id`, MACHINE_ID_RE),
    boot: readId(`${procRoot}/sys/kernel/random/boot_id`, BOOT_ID_RE),
  };
}

/** HMAC-SHA-256 under `key` of `ccrc-host-<kind>-v1`, a newline and the value, as lowercase hex. */
export function hostDigest(key, kind, value) {
  return createHmac('sha256', key).update(`ccrc-host-${kind}-v1\n${value}`).digest('hex');
}

/** The report an agent sends: its uid, and each id digested under the bearer, or `'unmeasured'`. */
export function hostReportOf(ids, uid, key) {
  return {
    uid: typeof uid === 'number' && Number.isSafeInteger(uid) && uid >= 0 ? uid : 'unmeasured',
    machine: ids.machine === 'unmeasured' ? 'unmeasured' : hostDigest(key, 'machine', ids.machine),
    boot: ids.boot === 'unmeasured' ? 'unmeasured' : hostDigest(key, 'boot', ids.boot),
  };
}
