// The expiry lane's attention list (workspace lifecycle spec 2026-09-24 §5.3, wave 3b), rendered INSIDE the cleanup
// row (`ChildReclaimBanner`), under the children's list and in its shape: a REPORT, never a tap — no button, no link,
// no remedy. Each line is the kind's word, the session, and the server's sentence; for a workspace a process keeps,
// that sentence names the pid, its command and the path, and says to find out what it is before ending it. Nothing
// renders when the list is empty or the server predates it.
import type { ReactNode } from 'react';
import { expiryAttentionOf, expiryKindWord } from './expiryWords';

export function ExpiryAttention({ coord }: { coord: unknown }): ReactNode {
  const list = expiryAttentionOf(coord);
  if (list.length === 0) return null;
  return (
    <ul className="child-reclaim-attention" aria-label="archived workspaces the cleanup is reporting">
      {list.map((a) => (
        <li key={a.sessionId} className="child-reclaim-item">
          <span className="child-reclaim-who">{`${expiryKindWord(a.kind)} · ${a.sessionId}`}</span>
          <span className="child-reclaim-sentence">{a.sentence}</span>
        </li>
      ))}
    </ul>
  );
}
