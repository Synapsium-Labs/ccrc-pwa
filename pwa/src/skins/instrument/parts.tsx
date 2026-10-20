// Instrument's parts (D-5469, W2 Task S2b). In this task both sets place today's shell, so Instrument is
// pixel-identical to Refined: the desk accounts strip as the bar and the fleet column beside the detail. S9 to S12
// replace them with Instrument's own parts (the rail, the top bar, the list column, the status bar). Composed from
// shared modules only; never from Refined's directory (`skin-boundary.test.ts`, from S4a).
import { INSTRUMENT } from '@ccrc/ui';
import { AccountsStrip } from '../../fleet/AccountsStrip';
import { FleetColumn } from '../../fleet/FleetColumn';
import type { SkinSet } from '../types';
import './instrument.css';

export const INSTRUMENT_SET: SkinSet = {
  id: INSTRUMENT,
  frameClass: 'ins-frame',
  Bar: AccountsStrip,
  Rail: null,
  Nav: FleetColumn,
  FleetList: null,
  SessionChrome: null,
  TranscriptRow: null,
  Inspector: null,
  StatusBar: null,
  PhoneNav: null,
  transcriptGrouping: 'none',
};
