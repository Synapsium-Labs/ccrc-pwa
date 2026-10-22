// Instrument's parts (D-5469; W2 Task S9, D-5472). At desk widths: the top bar across the frame's first row, the rail,
// the list column beside the detail, and the status bar along the foot. On a phone the frame mounts only the list
// column, today's fleet screen, until S11's phone parts. S10 to S12 fill the rest. Composed from shared modules
// only; never from Refined's directory (`skin-boundary.test.ts`, from S4a).
import { INSTRUMENT } from '@ccrc/ui';
import type { SkinSet } from '../types';
import { FleetTable } from './FleetTable';
import { ListColumn } from './ListColumn';
import { Rail } from './Rail';
import { StatusBar } from './StatusBar';
import { TopBar } from './TopBar';
import './instrument.css';

export const INSTRUMENT_SET: SkinSet = {
  id: INSTRUMENT,
  frameClass: 'ins-frame',
  Bar: TopBar,
  Rail,
  Nav: ListColumn,
  FleetList: FleetTable,
  SessionChrome: null,
  // No row part and no fold: each transcript item renders as today until S14's log rows (D-5475).
  TranscriptRow: null,
  Inspector: null,
  StatusBar,
  PhoneNav: null,
  transcriptGrouping: 'none',
};
