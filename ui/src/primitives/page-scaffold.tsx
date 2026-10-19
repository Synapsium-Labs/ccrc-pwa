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
//   - a body centred at `--page-max`, or `--page-max-wide` with `wide`, at
//     `--gutter`. Never a literal: pwa/test/page-scaffold.test.tsx reds one.
//
// THE NAV SLOT (D-5666, the Settings spec's §15.3 C3). A screen with its own
// section nav (Settings) hands it to `nav`: below a 960px pane it stacks above
// the body; from 960 it is a 13rem sticky column beside a body that keeps its
// `--page-max` cap. A container query, not a viewport one, because the pane's
// width is what the sidebar leaves, not the window's.
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
/** The header's row: as wide as the body's column, at the header's height. */
export const PAGE_HEAD_ROW = 'mx-auto flex w-full min-h-head items-center gap-2 px-gutter';
/** The caret shares the title's size and line, in the accent. */
export const PAGE_CARET = 'flex-none font-mono text-title font-medium leading-tight text-phosphor';
/** The title wraps rather than clipping: a long one takes a second line. */
export const PAGE_TITLE = 'm-0 min-w-0 flex-1 font-mono text-title font-medium leading-tight text-ink-primary wrap-break-word';
export const PAGE_ACTIONS = 'flex flex-none items-center gap-2';
export const PAGE_BODY = 'mx-auto grid w-full content-start gap-3 px-gutter pt-2 pb-section';

const COLUMN = { page: 'max-w-(--page-max)', wide: 'max-w-(--page-max-wide)' } as const;

export interface PageScaffoldProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  /** The page's name: the one h1. */
  title: ReactNode;
  /** Back, when the screen has one: its accessible label, what it does, and
   *  the screen's hook class for its tests. The desktop shell hides it inside
   *  the detail pane (shell.css, `.back-btn`). */
  back?: { label: string; onClick: () => void; className?: string };
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
    <div data-page-body="" className={cn(PAGE_BODY, column, nav !== undefined && 'mx-0')}>
      {children}
    </div>
  );
  return (
    <div data-page-scaffold="" className={cn('@container min-w-0', className)} {...props}>
      <header className={PAGE_HEAD}>
        <div className={cn(PAGE_HEAD_ROW, nav !== undefined ? COLUMN.wide : column)}>
          {back !== undefined && (
            <BackButton className={back.className} aria-label={back.label} onClick={back.onClick}>‹</BackButton>
          )}
          <span className={PAGE_CARET} aria-hidden="true">❯</span>
          <h1 className={PAGE_TITLE}>{title}</h1>
          {actions !== undefined && <div className={PAGE_ACTIONS}>{actions}</div>}
        </div>
      </header>
      {nav === undefined ? body : (
        <div className="mx-auto grid w-full max-w-(--page-max-wide) @min-[60rem]:grid-cols-[13rem_minmax(0,1fr)] @min-[60rem]:gap-6">
          <div className="min-w-0 px-gutter pt-2 @min-[60rem]:sticky @min-[60rem]:top-head @min-[60rem]:self-start @min-[60rem]:pr-0">
            {nav}
          </div>
          {body}
        </div>
      )}
    </div>
  );
}
