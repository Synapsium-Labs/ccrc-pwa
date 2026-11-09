// The Docs head's layout deciders (desk-nav Part B, D-8101; moved out of DocsHead.tsx by desktop-polish Task C16,
// D-8139, review 1704 F10): which head a page draws, how the full head is drawn, and the stages the desk row tries in
// order. Pure: each answers from its arguments, and DocsHead.tsx measures and renders. The trial render that finds a
// row's stage (`useRowStage`) and the two DOM readers it uses (`nameCut`, `rowFits`) stay in DocsHead.tsx, because they
// read the laid-out page; this module only names the order they try.
import type { DocsPageLocation } from '../../../shared/docs';

/** Which header a page draws. */
export type HeadLayout = 'full' | 'compact';

/** The header for `page` (phone-header refinement (a)): the compact row on a leaf page at the compact width, else the full header. A
 *  directory (its URL ends in `/`), a section, a project and the index keep the full header at every width. */
export function headLayoutFor(compactWidth: boolean, page: DocsPageLocation): HeadLayout {
  return compactWidth && page.kind === 'path' && !page.dirSlash ? 'compact' : 'full';
}

/** How the full header is drawn (desk-nav Part B, D-8101; fix round 1, F2(b)): at 600 CSS px and wider, the desk head's
 *  one row and dense line (`row`); under the compact width, where only a listing or the index draws the full header,
 *  the stacked header main drew (`stacked`): the crumbs row, the truth line, then the actions in words. Part B is the
 *  head at 600 px and wider, so below it nothing changes. */
export type FullHeadForm = 'row' | 'stacked';

export function fullHeadFormFor(compactWidth: boolean): FullHeadForm {
  return compactWidth ? 'stacked' : 'row';
}

/** How far the desk row has given way (desk-nav Part B, fix round 2, D-8101): 0, every crumb and the action words; 1,
 *  every crumb and the actions as icons; 2, the actions as icons and the middle crumbs folded behind `…`. Past 2,
 *  docs.css gives way: the page's name shortens to its floor, and only then do the actions wrap onto a second line. */
export type RowStage = 0 | 1 | 2;

/** The stages in the order the row tries them: the first that fits is the row's, and the last is kept whatever it
 *  measures. */
export const ROW_STAGES: readonly RowStage[] = [0, 1, 2];
