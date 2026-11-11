import {
  BACKUP_OP, DISK_OP, PRESSURE_OP, READDIR_MTIMES_OP, TESTBOX_ADMIN_OP, TESTBOX_OP, TESTBOX_OP_REQUEST_MS, TESTBOX_TOOLS_SYNC_OP, isReadFromRange,
  readTestboxAdminOpAnswer, readTestboxOpReply, readTestboxToolsSyncReply, testboxAdminRequestTimeoutMs, type TailData, type TailReset,
} from '../../../shared/agent-protocol.js';
import { buildTestboxAdminArgv, testboxAdminIsLong } from '../../../shared/testbox-admin.js';
import { readDiskMeasured } from '../../../shared/disk.js';
import { readHeadroomBytes, readHostPsi } from '../../../shared/pressure.js';
import { readBackupRead } from '../../../shared/backup.js';
import type { FleetIO, MeasuredDirectoryRead, ReadFailure } from '../io.js';
import type { FleetClient } from './client.js';
import { AgentOpError, LinkNotSentError } from './errors.js';

/**
 * `FleetIO` over the agent's read/readFrom/readB64/readdir/stat/writeB64/tailOpen ops.
 * Most read ops mirror `localIO`'s "never throws, null on any failure"
 * contract — a disconnected agent or a forbidden path both collapse to the
 * same "no data" result callers already handle. `writeFileB64` mirrors
 * `localIO`'s write, which does NOT swallow failures — it throws, same as
 * here.
 *
 * `readFileMeasured` is the one exception: it is the SINGLE READER of the
 * `read` op's `absent?: true` wire field (`{data: string|null, absent?:
 * true}`, `shared/agent-protocol.ts#ResOk`'s op payloads). `absent` is set true ONLY on the
 * agent's own proven ENOENT; anything else — including an OLDER agent whose
 * response omits the field entirely — must fail SHUT to `unreadable`, never
 * be assumed `absent`. A rejected request (disconnected/timeout/forbidden/
 * bad-request) is `unreadable` too: `forbidden` in particular is never
 * `absent` — `checkPath` refuses a path that very often also does not exist,
 * and conflating the two would let a whitelist refusal masquerade as
 * evidence the path is clear.
 *
 * `statMeasured` is the second such reader, on the `stat` op's `absent?:
 * true`, and it is the reason D-114 could be closed at all: a bare
 * `missing: true` is what an OLDER agent sends for EVERY stat failure and
 * what a NEWER one sends for EACCES/ENOTDIR/ELOOP, so it means UNMEASURED,
 * never proof. Only `absent: true` proves.
 */

function isTailReset(msg: TailData | TailReset): msg is TailReset {
  return (msg as TailReset).reset === true;
}

/** The bytes of CANONICAL base64, or null. Node's decoder accepts far more than
 *  the canonical form — the URL-safe letters, missing padding, interior
 *  whitespace, junk it skips, a second spelling of the same bytes — so "it
 *  decoded" proves nothing; the test is that encoding the decode gives the input
 *  back, character for character. A plain `Uint8Array` (a copy), never a
 *  pooled `Buffer` view. */
function decodeCanonicalBase64(text: string): Uint8Array | null {
  const bytes = Buffer.from(text, 'base64');
  return bytes.toString('base64') === text ? new Uint8Array(bytes) : null;
}

/** The `readdir` answer's names, exactly as `readdirMeasured` has always read them (one reader; the times arm reuses it). */
function readdirAnswer(res: unknown): { read: MeasuredDirectoryRead } {
  const r = res as { names?: unknown; absent?: unknown } | null;
  if (r !== null && typeof r === 'object') {
    if (Array.isArray(r.names)) {
      return { read: r.names.every((n) => typeof n === 'string')
        ? { ok: true, entries: r.names as string[] }
        : { ok: false, reason: 'unreadable' } };
    }
    if (r.names === null && r.absent === true) return { read: { ok: false, reason: 'absent' } };
  }
  return { read: { ok: false, reason: 'unreadable' } };
}

/** The ONE reader of the `readdir` op's `times`: a plain object whose every value is a finite number, keyed by a
 *  listed name, becomes a Map; anything else (absent, malformed) is `undefined`, so the caller keys by names alone. */
function readdirTimes(res: unknown, entries: readonly string[]): ReadonlyMap<string, number> | undefined {
  const t = (res as { times?: unknown }).times;
  if (t === null || typeof t !== 'object' || Array.isArray(t)) return undefined;
  const listed = new Set(entries);
  const out = new Map<string, number>();
  for (const [k, v] of Object.entries(t)) {
    if (!listed.has(k) || typeof v !== 'number' || !Number.isFinite(v)) return undefined;
    out.set(k, v);
  }
  return out;
}

export function createIo(client: FleetClient): FleetIO {
  return {
    /** No agent op resolves symlinks, and the paths live on the REMOTE box —
     *  a local node:fs realpath would answer about the wrong disk. Null means
     *  "cannot resolve", which every caller degrades to the unresolved path,
     *  i.e. remote mode keeps its pre-realpath behavior until the agent
     *  protocol grows a resolver op. */
    async realpath() {
      return null;
    },

    async readFileMeasured(path, timeoutMs, signal) {
      try {
        const res = await client.request({ t: 'req', op: 'read', path }, timeoutMs, signal);
        const r = res as { data?: unknown; absent?: unknown };
        if (typeof r.data === 'string') return { ok: true, content: r.data };
        const reason: ReadFailure = r.absent === true ? 'absent' : 'unreadable';
        return { ok: false, reason };
      } catch {
        // Disconnected / timeout / forbidden / bad-request — none of these
        // are proof the path is absent (a `forbidden` refusal in particular
        // very often ALSO doesn't exist, but the whitelist told us nothing
        // about that).
        return { ok: false, reason: 'unreadable' };
      }
    },

    async readFile(path) {
      const r = await this.readFileMeasured(path);
      return r.ok ? r.content : null;
    },

    async readFileFromMeasured(path, offset) {
      try {
        const res = await client.request({ t: 'req', op: 'readFrom', path, offset });
        const r = res as { data?: unknown; size?: unknown; absent?: unknown };
        if (typeof r.data === 'string') {
          return { ok: true, data: r.data, size: typeof r.size === 'number' ? r.size : Buffer.byteLength(r.data, 'utf8') };
        }
        return { ok: false, reason: r.absent === true ? 'absent' : 'unreadable' };
      } catch {
        return { ok: false, reason: 'unreadable' };
      }
    },

    async readFileFrom(path, offset) {
      const r = await this.readFileFromMeasured(path, offset);
      return r.ok ? { data: r.data, size: r.size } : null;
    },

    /** The `readFrom` op's BYTE reader — the sibling of `readFileFromMeasured`
     *  above, and the only one that wants bytes. It asks with `maxBytes` and
     *  trusts `dataB64` ALONE: an agent that predates the field ignores
     *  `maxBytes` and answers decoded `data`, and text is not bytes — a split
     *  multibyte character has already been replaced by U+FFFD in it — so that
     *  answer is `unreadable`, never re-encoded. `dataB64` must be canonical
     *  base64, `size` a non-negative safe integer, and the decoded length
     *  EXACTLY `min(maxBytes, size - offset)`; a size below `offset` makes that
     *  negative and fails the same test, which is how a regression reads. Every
     *  other shape, and every refusal, timeout or disconnect, is `unreadable`;
     *  `absent` is the agent's own `data: null, absent: true` and nothing else. */
    async readFileFromBytesMeasured(path, offset, maxBytes, timeoutMs, signal) {
      if (!isReadFromRange(offset, maxBytes)) return { ok: false, reason: 'unreadable' };
      try {
        const res = await client.request({ t: 'req', op: 'readFrom', path, offset, maxBytes }, timeoutMs, signal);
        const r = res as { data?: unknown; dataB64?: unknown; size?: unknown; absent?: unknown } | null;
        if (r === null || typeof r !== 'object') return { ok: false, reason: 'unreadable' };
        if (typeof r.dataB64 === 'string') {
          const bytes = decodeCanonicalBase64(r.dataB64);
          const size = r.size;
          if (bytes === null || typeof size !== 'number' || !Number.isSafeInteger(size) || size < 0) {
            return { ok: false, reason: 'unreadable' };
          }
          if (bytes.length !== Math.min(maxBytes, size - offset)) return { ok: false, reason: 'unreadable' };
          return { ok: true, bytes, size };
        }
        if (r.data === null && r.absent === true) return { ok: false, reason: 'absent' };
        return { ok: false, reason: 'unreadable' };
      } catch {
        return { ok: false, reason: 'unreadable' };
      }
    },

    async readFileB64Measured(path) {
      try {
        const res = await client.request({ t: 'req', op: 'readB64', path });
        const r = res as { dataB64?: unknown; absent?: unknown; tooLarge?: unknown; size?: unknown };
        if (typeof r.dataB64 === 'string') return { ok: true, dataB64: r.dataB64 };
        // `tooLarge` first: an over-cap file is present, so it must never be
        // reported as absent even if a future agent sent both markers.
        if (r.tooLarge === true) return { ok: false, reason: 'too-large', size: typeof r.size === 'number' ? r.size : null };
        return { ok: false, reason: r.absent === true ? 'absent' : 'unreadable' };
      } catch {
        return { ok: false, reason: 'unreadable' };
      }
    },

    /** The `readdir` op's measured reader: it reads the wire's `absent` off a
     *  directory listing, where `names: null` WITH `absent: true` is a proven
     *  ENOENT. A bare `names: null` is what an older agent sends for every
     *  failure, so it is `unreadable`, never `absent`. A listing — an empty one
     *  included — is a positive answer and wins over a contradictory marker; a
     *  `names` holding anything but strings is malformed, not a listing. */
    async readdirMeasured(path, timeoutMs, signal) {
      try {
        return readdirAnswer(await client.request({ t: 'req', op: 'readdir', path }, timeoutMs, signal)).read;
      } catch {
        return { ok: false, reason: 'unreadable' };
      }
    },

    /** The same listing with each entry's modification time (console speed S1). The request carries `times: true`
     *  ONLY when the agent lists `readdir-mtimes`; an older agent is sent the plain frame it always was. `times` is
     *  read by ONE reader (`readdirTimes`): anything malformed is no times, never a failed listing. */
    async readdirWithTimesMeasured(path, timeoutMs, signal) {
      const asks = (client.state.agentOps ?? []).includes(READDIR_MTIMES_OP);
      try {
        const res = await client.request(asks ? { t: 'req', op: 'readdir', path, times: true } : { t: 'req', op: 'readdir', path }, timeoutMs, signal);
        const a = readdirAnswer(res);
        if (!asks || !a.read.ok) return a.read;
        const times = readdirTimes(res, a.read.entries);
        return times === undefined ? a.read : { ...a.read, times };
      } catch {
        return { ok: false, reason: 'unreadable' };
      }
    },

    async readdir(path, timeoutMs, signal) {
      const r = await this.readdirMeasured(path, timeoutMs, signal);
      return r.ok ? [...r.entries] : null;
    },

    async statMeasured(path) {
      try {
        const res = await client.request({ t: 'req', op: 'stat', path });
        const r = res as { missing?: unknown; absent?: unknown; mtimeMs?: unknown; size?: unknown };
        if (typeof r.mtimeMs === 'number' && typeof r.size === 'number') {
          return { ok: true, mtimeMs: r.mtimeMs, size: r.size };
        }
        return { ok: false, reason: r.absent === true ? 'absent' : 'unreadable' };
      } catch {
        // Disconnected / timeout / forbidden / bad-request — none of these is
        // proof the path is absent, same reasoning as `readFileMeasured`.
        return { ok: false, reason: 'unreadable' };
      }
    },

    async stat(path) {
      const r = await this.statMeasured(path);
      return r.ok ? { mtimeMs: r.mtimeMs, size: r.size } : null;
    },

    /** The THIRD reader on this file's own rule, and the one where the older
     *  peer's answer is not silence but a REFUSAL: an agent that predates the
     *  `lstat` op rejects the request (`not-implemented`), so it lands in the
     *  catch below as `unmeasured` rather than masquerading as a measured
     *  kind. That is why the caller may act on `regular` at all — the one
     *  answer that lets anything be condemned — and why `unmeasured` is a
     *  reason of its own here rather than folded into `unreadable`: a remote
     *  fleet whose agent is too old is not a fleet whose markers are
     *  unreadable, and the two must not be one value.
     *
     *  `missing: true` without `absent: true` keeps its wire meaning exactly
     *  as `statMeasured` reads it above: UNMEASURED, never proof. */
    async lstatMeasured(path) {
      try {
        const res = await client.request({ t: 'req', op: 'lstat', path });
        const r = res as { kind?: unknown; missing?: unknown; absent?: unknown };
        if (r.kind === 'regular' || r.kind === 'symlink' || r.kind === 'other') {
          return { ok: true, kind: r.kind };
        }
        if (r.absent === true) return { ok: false, reason: 'absent' };
        // A `missing: true` with no `absent`, or a payload in no shape this
        // reader knows: measured by nothing this side can trust.
        return { ok: false, reason: 'unmeasured' };
      } catch {
        return { ok: false, reason: 'unmeasured' };
      }
    },

    async writeFileB64(path, dataB64) {
      await client.request({ t: 'req', op: 'writeB64', path, dataB64 });
    },

    async tailFile(path, offset, onData, onReset) {
      return openRemoteTail(client, path, offset, onData, onReset);
    },

    /** The agent's `disk` op (D-6615). An agent whose `ready.ops` does not name it is never sent it (it would answer
     *  `bad-request`): that is `unmeasured`, exactly as a fault on the wire or a reply in no shape this reader knows
     *  is. `readDiskMeasured` checks every element of the reply, so a half-formed one is never taken for a measurement. */
    async statfsMeasured() {
      if (!(client.state.agentOps ?? []).includes(DISK_OP)) return { ok: false, reason: 'unmeasured' };
      try {
        const r = (await client.request({ t: 'req', op: DISK_OP })) as Record<string, unknown>;
        const measured = readDiskMeasured(r);
        return measured === null ? { ok: false, reason: 'unmeasured' } : { ok: true, measured };
      } catch {
        return { ok: false, reason: 'unmeasured' };
      }
    },

    /** The agent's `pressure` op (#1170). An agent whose `ready.ops` does not name it is never sent it: `unsupported`,
     *  never a stall. Anything the link or the agent failed, or a reply in no shape `readHostPsi` knows, is
     *  `unanswered`: the evidence the decider classifies a stall by. */
    async pressureMeasured() {
      if (!(client.state.agentOps ?? []).includes(PRESSURE_OP)) return { ok: false, reason: 'unsupported' };
      try {
        const reply = await client.request({ t: 'req', op: PRESSURE_OP });
        const psi = readHostPsi(reply);
        // D-8122: the slice's headroom rides beside the PSI; an older agent's reply has none, which reads as null.
        return psi === null ? { ok: false, reason: 'unanswered' } : { ok: true, psi, headroomBytes: readHeadroomBytes(reply) };
      } catch {
        return { ok: false, reason: 'unanswered' };
      }
    },

    /** The agent's `backup` op (D-7858). An agent whose `ready.ops` does not name it is never sent it: `unsupported`.
     *  Anything the link or the agent failed, or a reply in no shape `readBackupRead` knows, is `unanswered`. */
    async backupMeasured() {
      if (!(client.state.agentOps ?? []).includes(BACKUP_OP)) return { ok: false, reason: 'unsupported' };
      try {
        const read = readBackupRead(await client.request({ t: 'req', op: BACKUP_OP }));
        return read === null ? { ok: false, reason: 'unanswered' } : { ok: true, read };
      } catch {
        return { ok: false, reason: 'unanswered' };
      }
    },

    /** The agent's `testbox` op (D-7411). An agent whose `ready.ops` does not name it is never sent it: `no-op`, which
     *  the decider reads as `unreachable (agent has no testbox op)`, never `ok`. A fault on the wire or a reply off
     *  `readTestboxOpReply`'s shape is `unanswered`. */
    async testboxMeasured() {
      if (!(client.state.agentOps ?? []).includes(TESTBOX_OP)) return { ok: false, reason: 'no-op' };
      try {
        const reply = readTestboxOpReply(await client.request({ t: 'req', op: TESTBOX_OP }, TESTBOX_OP_REQUEST_MS));
        return reply === null ? { ok: false, reason: 'unanswered' } : { ok: true, reply };
      } catch {
        return { ok: false, reason: 'unanswered' };
      }
    },

    /** The agent's `testbox-tools-sync` op (D-7411, D-7555): the same gate on `ready.ops`, the same two failures. */
    async testboxToolsSync() {
      if (!(client.state.agentOps ?? []).includes(TESTBOX_TOOLS_SYNC_OP)) return { ok: false, reason: 'no-op' };
      try {
        const reply = readTestboxToolsSyncReply(await client.request({ t: 'req', op: TESTBOX_TOOLS_SYNC_OP }, TESTBOX_OP_REQUEST_MS));
        return reply === null ? { ok: false, reason: 'unanswered' } : { ok: true, reply };
      } catch {
        return { ok: false, reason: 'unanswered' };
      }
    },

    /** The agent's `testbox-admin` op (connect spec §2.1, D-8166): the builder runs here first (so a refusal never reaches
     *  the wire), and the frame is sent only to an agent whose ready frame names the op. An older agent that answers
     *  `bad-request` is `unsupported` too; a frame that never left is `not-started`; anything after the send is `lost`. */
    async testboxAdmin(sub, fields) {
      const built = buildTestboxAdminArgv(sub, fields);
      if (!built.ok) return { kind: 'refused', why: built.why };
      if (!(client.state.agentOps ?? []).includes(TESTBOX_ADMIN_OP)) return { kind: 'unsupported' };
      try {
        const res = await client.request(
          { t: 'req', op: TESTBOX_ADMIN_OP, sub, fields }, testboxAdminRequestTimeoutMs(testboxAdminIsLong(sub, fields)),
        );
        const answer = readTestboxAdminOpAnswer(res);
        if (answer === null) return { kind: 'lost' };
        // The node's identity rides the answer for the account ops' sake; the verb's route reads it from the fleet cell.
        const { fleetIdentity: _identity, ...outcome } = answer;
        return outcome;
      } catch (e) {
        if (e instanceof AgentOpError && e.code === 'bad-request') return { kind: 'unsupported' };
        if (e instanceof LinkNotSentError) return { kind: 'not-started' };
        return { kind: 'lost' };
      }
    },
  };
}

/**
 * Opens a tailOpen subscription and keeps it alive across reconnects.
 * `openTail`/`tailClose` state lives entirely on the agent connection — a
 * dropped socket loses it, so this re-establishes the subscription on every
 * successful handshake (`client.onConnected`, which fires whether the
 * client was already connected when `tailFile()` was called, connects for
 * the very first time afterward, or reconnects after a drop). A genuine
 * reconnect of a subscription that was actually live before never trusts a
 * naive resume — an outage can span an arbitrary number of
 * truncations/rewrites, so "size grew back past our old offset" is not
 * proof nothing was lost — so it re-stats the file and emits a reset before
 * re-opening from the fresh offset.
 */
function openRemoteTail(
  client: FleetClient,
  filePath: string,
  fromOffset: number,
  onData: (chunk: Buffer) => void,
  onReset: (size: number) => void,
): () => void {
  let closed = false;
  let currentTailId: number | null = null;
  let offset = fromOffset;
  let hasOpenedOnce = false;

  const detach = (): void => {
    if (currentTailId === null) return;
    const tailId = currentTailId;
    currentTailId = null;
    client.offTail(tailId);
    void client.request({ t: 'req', op: 'tailClose', tailId }).catch(() => {});
  };

  const wire = (tailId: number): void => {
    currentTailId = tailId;
    client.onTail(tailId, (msg) => {
      if (closed) return;
      if (isTailReset(msg)) {
        offset = msg.size;
        onReset(msg.size);
        return;
      }
      const chunk = Buffer.from(msg.dataB64, 'base64');
      offset += chunk.byteLength;
      onData(chunk);
    });
  };

  const openAt = async (at: number): Promise<void> => {
    if (closed) return;
    try {
      const res = await client.request({ t: 'req', op: 'tailOpen', path: filePath, offset: at });
      const tailId = (res as { tailId?: unknown }).tailId;
      if (closed) {
        if (typeof tailId === 'number') void client.request({ t: 'req', op: 'tailClose', tailId }).catch(() => {});
        return;
      }
      if (typeof tailId === 'number') {
        wire(tailId);
        hasOpenedOnce = true;
      }
    } catch {
      // Disconnected/forbidden right now — the next `onConnected` retries.
      // `tailFile` never rejects (mirrors `localIO`'s "keep waiting" stance
      // for a not-yet-existing file), so a transient failure here is silent.
    }
  };

  const resync = async (): Promise<void> => {
    if (currentTailId !== null) {
      client.offTail(currentTailId);
      currentTailId = null;
    }
    let size = offset;
    try {
      const res = await client.request({ t: 'req', op: 'stat', path: filePath });
      const r = res as { missing?: unknown; size?: unknown };
      size = r.missing === true ? 0 : typeof r.size === 'number' ? r.size : offset;
    } catch {
      // Couldn't stat on this attempt — fall back to the last known offset;
      // the reset below still forces a resync of anything we might have missed.
    }
    if (closed) return;
    offset = size;
    onReset(size);
    await openAt(size);
  };

  // Try immediately in case the client is already connected right now.
  void openAt(offset);

  const unsubscribeConnected = client.onConnected((isReconnect) => {
    if (closed) return;
    // Only resync (stat + reset + reopen) when a subscription that was
    // actually live before got lost to a real reconnect. A handshake that
    // completes AFTER `tailFile()` raced ahead of connection — first-ever
    // connect, or a reconnect that happened before we ever opened anything
    // — just needs a plain (re)try, not a resync of state that never existed.
    if (isReconnect && hasOpenedOnce) {
      void resync();
    } else if (currentTailId === null) {
      void openAt(offset);
    }
  });

  return () => {
    if (closed) return;
    closed = true;
    unsubscribeConnected();
    detach();
  };
}
