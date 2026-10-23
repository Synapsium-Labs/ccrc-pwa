// The shared frame (D-5466, W2 Task S2b): one frame, two sets of parts.
//
// WHY ONE FRAME. Spec §5.2 had `app.tsx` render `SKIN_SETS[skin].Shell` with the route ladder as a slot. Two Shell
// components are two element types, and React unmounts every child of an element whose type changes, the ladder
// included, so a switch would lose the composer's text, close every sheet the ladder owns and drop the terminal's
// socket: everything spec §5.4 says a switch keeps (measured red in `skin-switch.test.tsx`). So the frame below is
// the same element in both skins, its children are KEYED, and a skin only chooses which component fills a slot.
// React matches keyed children by key, not by position, so an empty slot moves nothing, and the `detail` child, the
// `<main>` holding the ladder, never changes type or key: the ladder stays mounted across a switch.
//
// THE LANDMARKS ARE THE FRAME'S, so a skin part cannot forget one: the skip link first, the bar in a `<header>`, the
// rail and the phone navigation each in a `<nav aria-label=…>`, the detail as the one `<main id="content">`, the
// inspector in an `<aside aria-label="Inspector">`, the status bar in a `<footer>`. The fleet column is its own
// `<section aria-label="Fleet">` (`FleetScreen`). DOM order is focus order; grid placement never reorders them.
//
// `SkinSetProvider` hands the set to shared screens (`useSkinSet()`), so `SessionScreen` and `ChatList` reach their
// skin's parts without branching on the skin (D-5469).
import { createContext, useContext, useLayoutEffect, useRef } from 'react';
import type { MouseEvent, ReactNode, Ref } from 'react';
import { DESK_QUERY, useMediaQuery } from '../lib/useMediaQuery';
import type { SkinSet } from './types';

const SkinSetContext = createContext<SkinSet | null>(null);

export function SkinSetProvider({ set, children }: { set: SkinSet; children?: ReactNode }): ReactNode {
  return <SkinSetContext.Provider value={set}>{children}</SkinSetContext.Provider>;
}

/** The parts of the skin in force. Throws outside the frame's provider, rather than answering a default skin: a
 *  screen that rendered one skin's parts under the other would say nothing. */
export function useSkinSet(): SkinSet {
  const set = useContext(SkinSetContext);
  if (set === null) throw new Error('SkinSetProvider is not mounted');
  return set;
}

/** The set in force, or null outside a frame (a component rendered on its
 *  own, as most suites do). For a shared component that only needs to know
 *  THAT a switch happened (`ChatList` re-measures): its identity changes on a
 *  switch and at no other time. Never compared to a skin id (D-5469). */
export function useFrameSet(): SkinSet | null {
  return useContext(SkinSetContext);
}

/** The skip link's target: the one main landmark. */
export const CONTENT_ID = 'content';

/** The fleet column's landmark (`FleetScreen`'s `<section aria-label="Fleet">`, `tabIndex={-1}`): the one landmark a
 *  phone's fleet view shows, where the main landmark is hidden. */
export const FLEET_ID = 'fleet';

/** Move focus to a landmark that is on screen, for a control that leaves the page and must not drop focus to the body.
 *  The phone swap hides the main landmark on the fleet view (`display: none`), and `focus()` on an element that is not
 *  rendered does nothing, so the main landmark is tried first and, when it did not take the focus, the fleet column's
 *  is. Decided by what the browser accepted, never by a skin id, a width or a media query. */
export function focusShownLandmark(): void {
  const main = document.getElementById(CONTENT_ID);
  main?.focus();
  if (main !== null && document.activeElement === main) return;
  document.getElementById(FLEET_ID)?.focus();
}

/** Move focus to the main landmark. Not left to the fragment: a hash on the URL would reach the router's
 *  `popstate`, and a fragment jump does not move focus in every browser. */
function skipToContent(e: MouseEvent<HTMLAnchorElement>): void {
  e.preventDefault();
  document.getElementById(CONTENT_ID)?.focus();
}

export interface ShellFrameProps {
  set: SkinSet;
  /** `fleet` on the fleet route, `session` for anything shown in the detail pane (the phone swap, `shell.css`). */
  view: 'fleet' | 'session';
  /** The detail pane, for the route-change scroll reset (D-161), which stays `app.tsx`'s. */
  detailRef: Ref<HTMLElement>;
  /** The route ladder, behind its boundary. */
  children: ReactNode;
}

export function ShellFrame({ set, view, detailRef, children }: ShellFrameProps): ReactNode {
  // The bar is a desk part in both of today's sets (D-5678): on a phone the accounts strip lives in the fleet screen
  // (`FleetColumn`'s `showAccounts`), so one instance is mounted at any width. Mounted, never CSS-hidden. The rail and
  // the status bar are desk parts too (W2 Task S9, D-5472): a phone's navigation is `PhoneNav`'s.
  const desk = useMediaQuery(DESK_QUERY);
  const { Bar, Banners, Rail, Nav, Inspector, StatusBar, PhoneNav } = set;
  // A SWITCH NEVER DROPS FOCUS TO <body> (spec §5.4, D-5679). What had focus in the
  // ladder or above the frame keeps it, because none of it remounts; a control
  // inside a part the switch replaced is gone, and the browser leaves focus on
  // the body, so it moves to the main landmark instead. Layout effect: before
  // a key pressed next can land on the body.
  const lastSet = useRef(set);
  useLayoutEffect(() => {
    if (lastSet.current === set) return;
    lastSet.current = set;
    const active = document.activeElement;
    if (active === null || active === document.body) document.getElementById(CONTENT_ID)?.focus({ preventScroll: true });
  }, [set]);
  return (
    <SkinSetProvider set={set}>
      <div className={`app-shell ${set.frameClass}`} data-view={view}>
        <a key="skip" className="skip-link" href={`#${CONTENT_ID}`} onClick={skipToContent}>
          Skip to content
        </a>
        {Bar !== null && desk && (
          <header key="bar" className="shell-accounts">
            <Bar />
          </header>
        )}
        {Banners !== null && desk && (
          // Under the bar on a desk (W2 Task S4b); below 900 the fleet column places the same stack. Mounted, never
          // CSS-hidden, so one stack is mounted at any width.
          <div key="banners" className="shell-banners">
            <Banners />
          </div>
        )}
        {Rail !== null && desk && (
          <nav key="rail" className="shell-rail" aria-label="Primary">
            <Rail />
          </nav>
        )}
        {Nav !== null && (
          // The fleet column: always mounted, so it is the desk sidebar; hidden on a phone while the detail shows.
          <div key="nav" className="shell-nav">
            <Nav />
          </div>
        )}
        <main key="detail" id={CONTENT_ID} className="shell-detail" ref={detailRef} tabIndex={-1}>
          {children}
        </main>
        {Inspector !== null && (
          <aside key="inspector" className="shell-inspector" aria-label="Inspector">
            <Inspector />
          </aside>
        )}
        {StatusBar !== null && desk && (
          <footer key="status" className="shell-status">
            <StatusBar />
          </footer>
        )}
        {PhoneNav !== null && (
          <nav key="phone-nav" className="shell-phone-nav" aria-label="Navigation">
            <PhoneNav />
          </nav>
        )}
      </div>
    </SkinSetProvider>
  );
}
