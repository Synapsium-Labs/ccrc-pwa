// Refined's parts (D-5469, W2 Task S2b). In this task both sets place today's shell: the desk accounts strip as the
// bar and the fleet column beside the detail. S4b to S8 replace them with Refined's own parts. Composed from shared
// modules only; never from Instrument's directory (`skin-boundary.test.ts`, from S4a).
import { REFINED } from '@ccrc/ui';
import { AccountsStrip } from '../../fleet/AccountsStrip';
import { FleetColumn } from '../../screens/FleetColumn';
import type { SkinSet } from '../types';
import { InspectorRail } from './InspectorRail';
import { SessionChrome } from './SessionChrome';
import { TranscriptRow } from './TranscriptRow';
import './refined.css';

export const REFINED_SET: SkinSet = {
  id: REFINED,
  frameClass: 'ref-frame',
  Bar: AccountsStrip,
  Rail: null,
  Nav: FleetColumn,
  FleetList: null,
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
