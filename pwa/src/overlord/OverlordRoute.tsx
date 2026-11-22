// The Overlord's place, `/overlord` (Overlord W1 home, Task 2): L4. Without `overlord-v1` (an answered caps read without the
// word, or one that failed) it replaces the address with the Fleet's, so nothing of the Overlord's is drawn; while the caps
// are loading it says so. With the word it draws the place: in PR A its heading and its state word, the whole place from PR B.
import type { ReactNode } from 'react';
import { PageScaffold } from '@ccrc/ui';
import { FLEET_PATH } from '../lib/routes';
import { useDesignationState, useOverlordShown, useOverlordStore } from '../stores/overlord';
import { DESIGNATION_WORDS } from './homePlace';
import { useReplaceWhen } from './HomeRoute';

export function OverlordRoute(): ReactNode {
  const shown = useOverlordShown();
  const capsLoading = useOverlordStore((s) => s.caps.state === 'loading');
  const designation = useDesignationState();
  useReplaceWhen(!capsLoading && !shown ? FLEET_PATH : null);
  if (!shown) return <p className="shell-placeholder-copy" role="status">Loading…</p>;
  return (
    <PageScaffold title="Overlord">
      <p role="status">{DESIGNATION_WORDS[designation.kind]}</p>
    </PageScaffold>
  );
}
