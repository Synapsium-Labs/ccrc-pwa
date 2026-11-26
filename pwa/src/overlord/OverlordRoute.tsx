// The Overlord's place, `/overlord` (Overlord W1 home, Task 2; home B, Task 4): L4. Without `overlord-v1` (an answered caps
// read without the word, or one that failed) it replaces the address with the Fleet's, so nothing of the Overlord's is drawn;
// while the caps are loading it says so and replaces nothing (it waits on the capability read). With the word it draws the
// place (`OverlordPlace`), whose head carries the designation's word (`designationWordOf`, L1): "Loading…" while the
// designation read is in flight, never the failure's sentence.
import type { ReactNode } from 'react';
import { FLEET_PATH } from '../lib/routes';
import { useOverlordShown, useOverlordStore } from '../stores/overlord';
import { useReplaceWhen } from './HomeRoute';
import { OverlordPlace } from './OverlordPlace';

export function OverlordRoute(): ReactNode {
  const shown = useOverlordShown();
  const capsLoading = useOverlordStore((s) => s.caps.state === 'loading');
  useReplaceWhen(!capsLoading && !shown ? FLEET_PATH : null);
  if (!shown) return <p className="shell-placeholder-copy" role="status">Loading…</p>;
  return <OverlordPlace />;
}
