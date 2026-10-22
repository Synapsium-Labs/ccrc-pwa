// Instrument's list column (W2 Task S9, D-5472): the frame's `nav` slot, 340px beside the rail (420 at >=1600), on
// `--bg-page`. It holds the shared `FleetColumn`, whose list is this set's `FleetList` part, the status-grouped table (S10, D-5473).
import type { ReactNode } from 'react';
import { FleetColumn } from '../../screens/FleetColumn';

export function ListColumn(): ReactNode {
  return <FleetColumn />;
}
