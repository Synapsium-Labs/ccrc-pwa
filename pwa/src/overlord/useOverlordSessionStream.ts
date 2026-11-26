// The place-visible report (Overlord W1 home B, Task 4; plan question 4, ruled F3, slug `place-visible-rides-the-session-socket`):
// L4. While the Overlord's place is mounted with the bound session's id, this opens that session's stream through the session
// store's own `connect()`, and closes it on unmount or when the binding moves. The store's existing beat then sends
// `{ type: 'visible', visible }` every `VIEWER_REFRESH_MS` (15 s), and the server keeps it as the `Viewers` visible claim. It opens
// no second stream and adds no frame: the chat piece reuses this handle, and `/s/<id>` sends the same frames.
import { useEffect } from 'react';
import { getSessionStore } from '../stores/session';

export function useOverlordSessionStream(sessionId: string | null): void {
  useEffect(() => {
    if (sessionId === null) return undefined;
    const store = getSessionStore(sessionId);
    store.getState().connect();
    return () => store.getState().disconnect();
  }, [sessionId]);
}
