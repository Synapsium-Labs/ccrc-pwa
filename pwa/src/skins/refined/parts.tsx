// Refined's parts (D-5469, W2 Task S2b). S2b placed today's shell in both sets; S4b to S8 replace them with Refined's
// own parts: from S4b the desk bar is the app bar, the banners span the frame under it, and the sidebar is the fleet
// column without the doors and banners the bar now holds. Composed from shared
// modules only; never from Instrument's directory (`skin-boundary.test.ts`, from S4a).
import type { ReactNode } from 'react';
import { REFINED } from '@ccrc/ui';
import { FleetColumn } from '../../screens/FleetColumn';
import { FleetBanners } from '../../screens/FleetScreen';
import type { SkinSet } from '../types';
import { AppBar } from './AppBar';
import { InspectorRail } from './InspectorRail';
import { NewFab } from './NewFab';
import { PhoneHeader } from './PhoneHeader';
import { SessionChrome } from './SessionChrome';
import { TranscriptRow } from './TranscriptRow';
import './refined.css';

/** The sidebar (W2 Task S4b): today's fleet column, whose doors and banners the bar holds at a desk. S6 redesigns it. */
function Sidebar(): ReactNode {
  return <FleetColumn barHoldsChrome />;
}

export const REFINED_SET: SkinSet = {
  id: REFINED,
  frameClass: 'ref-frame',
  // W2 Task S4b (D-5471): the app bar, the banners under it, and the sidebar.
  Bar: AppBar,
  Banners: FleetBanners,
  Rail: null,
  Nav: Sidebar,
  FleetList: null,
  // W2 Task S5 (D-5471): the phone's header, its readout and gauges, and the extended `+ New`.
  Head: PhoneHeader,
  Fab: NewFab,
  // W2 Task S7c (D-5471): the short header and its one chip rail.
  SessionChrome,
  // W2 Task S13b (D-5475): a run of tool entries reads as one plain-language row.
  TranscriptRow,
  // W2 Task S8 (D-5474): the shared sections in a 320 rail at >=1600, on a session route only.
  Inspector: InspectorRail,
  StatusBar: null,
  PhoneNav: null,
  transcriptGrouping: 'tool-runs',
};
