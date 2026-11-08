// The expiry lane's attention list (workspace lifecycle spec 2026-09-24 §5.3, wave 3b), rendered INSIDE the cleanup
// row (`ChildReclaimBanner`), under the children's list and in its shape — `AttentionList` IS that shape. Each line is
// the kind's word, the session, and the server's sentence; for a workspace a process keeps, that sentence names the
// pid, its command and the path, and says to find out what it is before ending it. Nothing renders when the list is
// empty or the server predates it.
import type { ReactNode } from 'react';
import { AttentionList, attentionLines } from './AttentionList';
import { expiryAttentionOf } from './expiryWords';

export function ExpiryAttention({ coord }: { coord: unknown }): ReactNode {
  return (
    <AttentionList
      label="archived workspaces the cleanup is reporting"
      lines={attentionLines(expiryAttentionOf(coord))}
    />
  );
}
