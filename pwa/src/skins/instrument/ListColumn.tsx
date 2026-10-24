// Instrument's list column (W2 Task S9, D-5472): the frame's `nav` slot, 340px beside the rail (420 at >=1600), on
// `--bg-page`. It holds the shared `FleetColumn`, whose list is this set's `FleetList` part, the status-grouped table (S10, D-5473).
// At a desk its head is the pool lag alone, and none at all when the epochs agree (W2 desk polish T2e, D-6335; T2g,
// D-6715): the top bar holds the wordmark, the rail and its foot the Docs, Accounts, Settings, Inbox and Bell doors, and
// the status bar the fleet's count, so a second set in the column is a second head. The banner stack stays here,
// because Instrument's `Banners` part is `null`.
import type { ReactNode } from 'react';
import { FleetColumn } from '../../screens/FleetColumn';

export function ListColumn(): ReactNode {
  return <FleetColumn headChrome={false} headCount={false} />;
}
