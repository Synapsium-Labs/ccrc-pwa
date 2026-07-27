import type { TailData, TailReset } from '../../../shared/agent-protocol.js';
import type { FleetIO } from '../io.js';
import type { FleetClient } from './client.js';

/**
 * `FleetIO` over the agent's read/readFrom/readB64/readdir/stat/writeB64/tailOpen ops.
 * Read ops mirror `localIO`'s "never throws, null on any failure" contract —
 * a disconnected agent or a forbidden path both collapse to the same "no
 * data" result callers already handle. `writeFileB64` mirrors `localIO`'s
 * write, which does NOT swallow failures — it throws, same as here.
 */

function isTailReset(msg: TailData | TailReset): msg is TailReset {
  return (msg as TailReset).reset === true;
}

export function createIo(client: FleetClient): FleetIO {
  return {
    async readFile(path) {
      try {
        const res = await client.request({ t: 'req', op: 'read', path });
        const data = (res as { data?: unknown }).data;
        return typeof data === 'string' ? data : null;
      } catch {
        return null;
      }
    },

    async readFileFrom(path, offset) {
      try {
        const res = await client.request({ t: 'req', op: 'readFrom', path, offset });
        const r = res as { data?: unknown; size?: unknown };
        if (typeof r.data !== 'string') return null;
        return { data: r.data, size: typeof r.size === 'number' ? r.size : Buffer.byteLength(r.data, 'utf8') };
      } catch {
        return null;
      }
    },

    async readFileB64(path) {
      try {
        const res = await client.request({ t: 'req', op: 'readB64', path });
        const data = (res as { dataB64?: unknown }).dataB64;
        return typeof data === 'string' ? data : null;
      } catch {
        return null;
      }
    },

    async readdir(path) {
      try {
        const res = await client.request({ t: 'req', op: 'readdir', path });
        const names = (res as { names?: unknown }).names;
        return Array.isArray(names) ? (names as string[]) : null;
      } catch {
        return null;
      }
    },

    async stat(path) {
      try {
        const res = await client.request({ t: 'req', op: 'stat', path });
        const r = res as { missing?: unknown; mtimeMs?: unknown; size?: unknown };
        if (r.missing === true) return null;
        if (typeof r.mtimeMs !== 'number' || typeof r.size !== 'number') return null;
        return { mtimeMs: r.mtimeMs, size: r.size };
      } catch {
        return null;
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
