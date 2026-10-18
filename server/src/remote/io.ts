import { isReadFromRange, type TailData, type TailReset } from '../../../shared/agent-protocol.js';
import type { FleetIO, ReadFailure } from '../io.js';
import type { FleetClient } from './client.js';

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
 * true}`, `shared/agent-protocol.ts:105`). `absent` is set true ONLY on the
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

    async readFileB64(path) {
      const r = await this.readFileB64Measured(path);
      return r.ok ? r.dataB64 : null;
    },

    /** The `readdir` op's measured reader: it reads the wire's `absent` off a
     *  directory listing, where `names: null` WITH `absent: true` is a proven
     *  ENOENT. A bare `names: null` is what an older agent sends for every
     *  failure, so it is `unreadable`, never `absent`. A listing — an empty one
     *  included — is a positive answer and wins over a contradictory marker; a
     *  `names` holding anything but strings is malformed, not a listing. */
    async readdirMeasured(path, timeoutMs, signal) {
      try {
        const res = await client.request({ t: 'req', op: 'readdir', path }, timeoutMs, signal);
        const r = res as { names?: unknown; absent?: unknown } | null;
        if (r !== null && typeof r === 'object') {
          if (Array.isArray(r.names)) {
            return r.names.every((n) => typeof n === 'string')
              ? { ok: true, entries: r.names as string[] }
              : { ok: false, reason: 'unreadable' };
          }
          if (r.names === null && r.absent === true) return { ok: false, reason: 'absent' };
        }
        return { ok: false, reason: 'unreadable' };
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
