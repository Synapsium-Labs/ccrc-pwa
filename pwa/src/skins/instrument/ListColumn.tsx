// Instrument's list column (W2 Task S9, D-5472): the frame's `nav` slot, 340px beside the rail (420 at >=1600), on
// `--bg-page`. It holds today's fleet list, the shared `FleetColumn`, until S10's status-grouped table replaces it.
import type { ReactNode } from 'react';
import { FleetColumn } from '../../screens/FleetColumn';

export function ListColumn(): ReactNode {
  return <FleetColumn />;
}
