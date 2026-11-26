// PageScaffold — every secondary screen's header and column (D-5102).
//
// Mail, Runs, Accounts and Archive each drew their own head before this: three
// copies of `display: flex; gap: var(--sp-2)` around a BackButton and a 15px
// mono title, and Archive drew none, so on a phone it had no way back but the
// browser's own. Their bodies were full-pane grids at an 8px pad, so on a wide
// screen a mail row ran 1600px across. One drawing now, on the skin's tokens:
//
//   - a sticky header (`--head-h`: 56 in Refined; in Instrument 40 under a fine
//     pointer and the 44px tap floor otherwise, D-5667) on the page's own
//     ground, so the body scrolls under it;
//   - Back, then `❯` in the accent, then the title at `--fs-page`, then the
//     actions. The caret is identity core (spec §3.1, §12 O3), drawn in both
//     skins, and aria-hidden: the heading's name is the title alone;
//   - a body capped at `--page-max`, or `--page-max-wide` with `wide`, at
//     `--gutter`, centred in a wider pane or kept at the gutter as the skin's
//     `--page-margin-inline` says (Refined `auto`, Instrument at a desk `0`;
//     wave 182). Never a literal: pwa/test/page-scaffold.test.tsx reds one.
//
// THE NAV SLOT (D-5666, the Settings spec's §15.3 C3; its geometry D-5668). A
// screen with its own section nav (Settings) hands it to `nav`. From a pane of
// PAGE_NAV_MIN_PX (760) it is a sticky column 200px wide (220 from a 1600px
// viewport) beside a body that keeps its `--page-max` cap; the gutter sits
// outside the nav, and the body keeps only its right one, so at a 960 pane in
// Refined the column is 688 (spec §4.2). Below the threshold the slot draws
// nothing: a phone or a narrow pane shows the screen's own index instead, and
// the body is centred as on a page with no nav. A container query, not a
// viewport one, because the pane's width is what the sidebar leaves, not the
// window's; the caller's hook reads PAGE_NAV_MIN_PX, the same number.
//
// NO STYLESHEET, so no contrast-gate key: utilities over tokens, whose pairs
// design/contrast-check.mjs measures in every palette (`--ink-primary` and
// `--accent` on `--bg-page`).
import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../lib/cn';
import { BackButton } from './back-button';

/** The header: sticky over the body, painted with the page's ground so a row
 *  scrolling under it never shows through. */
export const PAGE_HEAD = 'sticky top-0 z-10 bg-page';
/** Under a mouse, every control in the header's row (Back and the actions) is `min(--row-h, --tap-min)` tall, centred in
 *  the row: Instrument's 32 in its 40 row, where at the tap floor it was 44 and stretched the row past `--head-h`;
 *  Refined's stays 44 (its row is 56). `pointer-fine:` is `@media (pointer: fine)`, the one condition Instrument's dense
 *  rows and toggle already read: it asks the PRIMARY pointer, as the whole console does. A device whose primary pointer is
 *  coarse keeps 44, with or without a mouse attached; one whose primary pointer is fine (a laptop's trackpad) takes the
 *  mouse size, even with a touchscreen. Nothing outside the row changes (desktop polish wave 182, the coordinator's word
 *  for this one rule and its ruling on such a laptop). */
export const PAGE_HEAD_CONTROLS = 'pointer-fine:[&_:is(button,select)]:min-h-[min(var(--row-h),var(--tap-min))]';
/** The header's row: as wide as the body's column, at the header's height. */
export const PAGE_HEAD_ROW = `mx-(--page-margin-inline) flex w-full min-h-head items-center gap-2 px-gutter ${PAGE_HEAD_CONTROLS}`;
/** The caret shares the title's size and line, in the accent. */
export const PAGE_CARET = 'flex-none font-mono text-title font-medium leading-tight text-phosphor';
/** The title wraps rather than clipping: a long one takes a second line. */
export const PAGE_TITLE = 'm-0 min-w-0 flex-1 font-mono text-title font-medium leading-tight text-ink-primary wrap-break-word';
export const PAGE_ACTIONS = 'flex flex-none items-center gap-2';
export const PAGE_BODY = 'mx-(--page-margin-inline) grid w-full content-start gap-3 px-gutter pt-2 pb-section';
/** Focus never lands under the sticky header (WCAG 2.2 SC 2.4.11). When Tab or
 *  Shift+Tab scrolls a row into view, the browser stops at the row's scroll
 *  margin, so every element in the body and the nav keeps the header's height
 *  and one step of air clear above it (D-5667). On the scaffold, not on the
 *  scrollers: the phone scrolls the document and the desktop the detail pane,
 *  and only this page has a header to clear. */
export const PAGE_FOCUS_CLEAR = '[&_*]:scroll-mt-[calc(var(--head-h)+var(--sp-2))]';

/** The pane width (px) from which the nav slot sits beside the body (D-5668).
 *  Every `@min-[…]` below spells this number; page-scaffold.test.tsx reds a
 *  drift. */
export const PAGE_NAV_MIN_PX = 760;

const COLUMN = { page: 'max-w-(--page-max)', wide: 'max-w-(--page-max-wide)' } as const;

export interface PageScaffoldProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  /** The page's name: the one h1. */
  title: ReactNode;
  /** Back, when the screen has one: its accessible label, what it does, and
   *  the screen's hook class for its tests. The desktop shell hides it inside
   *  the detail pane (shell.css, `.back-btn`). `data-command` is the
   *  registry command it stands for, when it is one (the app's `doorMark`). */
  back?: { label: string; onClick: () => void; className?: string; 'data-command'?: string };
  /** Controls at the header's right, after the title. */
  actions?: ReactNode;
  /** The wide column (`--page-max-wide`): a board, not a reading column. */
  wide?: boolean;
  /** A section nav beside the body (D-5666). */
  nav?: ReactNode;
  children?: ReactNode;
  className?: string;
}

export function PageScaffold({
  title, back, actions, wide = false, nav, children, className, ...props
}: PageScaffoldProps): ReactNode {
  const column = wide ? COLUMN.wide : COLUMN.page;
  const body = (
    <div
      data-page-body=""
      className={cn(PAGE_BODY, PAGE_FOCUS_CLEAR, column, nav !== undefined && '@min-[760px]:mx-0 @min-[760px]:pl-0')}
    >
      {children}
    </div>
  );
  return (
    <div data-page-scaffold="" className={cn('@container min-w-0', className)} {...props}>
      <header className={PAGE_HEAD}>
        <div className={cn(PAGE_HEAD_ROW, nav !== undefined ? COLUMN.wide : column)}>
          {back !== undefined && (
            <BackButton className={back.className} aria-label={back.label} onClick={back.onClick} data-command={back['data-command']}>‹</BackButton>
          )}
          <span className={PAGE_CARET} aria-hidden="true">❯</span>
          <h1 className={PAGE_TITLE}>{title}</h1>
          {actions !== undefined && <div className={PAGE_ACTIONS}>{actions}</div>}
        </div>
      </header>
      {nav === undefined ? body : (
        <div
          className={cn(
            'mx-(--page-margin-inline) grid w-full max-w-(--page-max-wide)',
            '@min-[760px]:grid-cols-[200px_minmax(0,1fr)] min-[1600px]:@min-[760px]:grid-cols-[220px_minmax(0,1fr)]',
            '@min-[760px]:gap-6 @min-[760px]:pl-gutter',
          )}
        >
          <div
            className={cn(
              PAGE_FOCUS_CLEAR,
              'hidden min-w-0 pt-2 @min-[760px]:block @min-[760px]:sticky @min-[760px]:top-head @min-[760px]:self-start',
            )}
          >
            {nav}
          </div>
          {body}
        </div>
      )}
    </div>
  );
}
