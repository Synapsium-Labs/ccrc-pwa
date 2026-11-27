// Reads the host's applied appearance once, immediately before a hosted mount or update.
import { appearanceStamp } from '../../lib/appearanceStamp';
import { readerAppearanceOf, type ReaderAppearanceOutcome } from './appearance';

export function readHostAppearance(root: HTMLElement): { readonly stamp: string; readonly outcome: ReaderAppearanceOutcome } {
  const style = getComputedStyle(root);
  return {
    stamp: appearanceStamp(root),
    outcome: readerAppearanceOf((token) => style.getPropertyValue(token), style.getPropertyValue('color-scheme')),
  };
}
