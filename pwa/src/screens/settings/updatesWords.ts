// D-7571 (ARCH-05): the Updates section's two word tables, moved out of `UpdatesSection.tsx` so the Settings
// section status (`sectionStatus.ts`) reads them without loading the section. The notes under each option stay
// with the section, their one reader.
import type { AutoMode, UpdateChannel } from '../../../../shared/api';

/** The channel labels (settings spec §11.2: the old "Stable — releases promoted after they've baked" became the label
 *  "Stable" with its note), one radio row each. The name stays for its importers. */
export const CHANNEL_SENTENCES: Record<UpdateChannel, string> = {
  stable: 'Stable',
  dev: 'Dev',
};

/** The auto-install choices (`AutoMode`, W2) in spec §11.2's words. The wire's values do not change. */
export const AUTO_LABELS: Record<AutoMode, string> = {
  off: 'Off',
  stable: 'On the Stable channel only',
  channel: 'On any channel',
};
