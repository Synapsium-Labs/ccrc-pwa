// The chat's mount in the Overlord place (Overlord W1, the chat, Task 4; spec §4 Table 4a, part 7): L4. It reuses the place's
// one stream (ruled F3): the bound session's store, which `useOverlordSessionStream` has already connected, gives the current
// generation's transcript rows (`buildChatItems`, the session view's own rows) and the frames the refresh reads. It opens no
// stream and adds no frame of its own: a change of the store's transcript or status is handed on as the frame it came from, and
// a beat changes neither, so the allow-list never sees one. The port is the shared client's three calls.
import { useCallback, useMemo } from 'react';
import type { ReactNode } from 'react';
import type { SessionStreamMsg } from '../../../shared/api';
import { api } from '../lib/api';
import { buildChatItems } from '../session/chatItems';
import { getSessionStore } from '../stores/session';
import { OverlordChat } from './OverlordChat';
import type { OverlordChatPort } from './useOverlordChat';

const PORT: OverlordChatPort = {
  thread: () => api.overlordChat(),
  earlier: (gen, around) => api.overlordChatEarlier(gen, around),
  send: (id, text, opts) => api.overlordSend(id, text, opts),
};

function BoundChat({ sessionId, port }: { readonly sessionId: string; readonly port: OverlordChatPort }): ReactNode {
  const store = getSessionStore(sessionId);
  const events = store((s) => s.events);
  const live = useMemo(() => buildChatItems(events, []), [events]);
  const subscribe = useCallback((onFrame: (msg: SessionStreamMsg) => void) => store.subscribe((next, prev) => {
    if (next.events !== prev.events) {
      const had = new Set(prev.events);
      const added = next.events.filter((e) => !had.has(e));
      if (added.length > 0) onFrame({ type: 'events', uuid: next.uuid ?? '', events: added, offset: next.offset });
    }
    if (next.status !== prev.status && next.status !== null) onFrame({ type: 'status', status: next.status, statusUpdatedAt: next.statusUpdatedAt });
  }), [store]);
  return <OverlordChat port={port} live={live} subscribe={subscribe} />;
}

/** Part 7. With no bound session the thread still reads (it answers `none` after a retire), with no live rows. */
export function ChatPart({ sessionId, port = PORT }: { readonly sessionId: string | null; readonly port?: OverlordChatPort }): ReactNode {
  return sessionId === null ? <OverlordChat port={port} live={[]} /> : <BoundChat key={sessionId} sessionId={sessionId} port={port} />;
}
