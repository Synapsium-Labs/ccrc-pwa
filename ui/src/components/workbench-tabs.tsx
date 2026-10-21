// WorkbenchTabs — the desk shell's strip of open tabs over one working surface,
// so two or more sessions, previews and screens stay one click apart. On a phone
// it collapses to the header's switcher: the active tab's title and the count of
// open tabs, one button that asks the app for the full list.
//
// PLAIN DATA IN, CALLBACKS OUT. The tab store is the app's: which tabs are open,
// which is active, their order, and opening something already open. This file
// keeps only local UI state — whether the strip overflows and which of its
// edges are cut (measured from the scroller), the drop marker while a drag is over a tab, and which tab should
// take focus after a keyboard close. Alt+1…9 and Alt+W are the app's global
// shortcuts, registered in its command registry, not here.
//
// ONE DEPARTURE FROM THE CARD, forced by axe 4.13. The card's close control is a
// button named "Close <title>"; axe reds it inside the tab (`nested-interactive`)
// and beside it in the tablist (`aria-required-children`). So the close control
// is pointer-only — `aria-hidden`, `tabIndex -1`, with a `title` — and keyboard
// and assistive-technology users close with Delete on the focused tab, which
// every closable tab declares in `aria-keyshortcuts`.
//
// GLOW MEANS LIFE. The tab adds no badge and no colour of its own: a session tab
// leads with its `StatusDot`, which glows only while busy or waiting on you and
// carries its own word and glyph, so a tab's state is never colour alone.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { DragEvent, KeyboardEvent, ReactNode } from 'react';
import { cn } from '../lib/cn';
import { FOCUS_RING } from '../lib/focus';
import { prefersReducedMotion } from '../lib/use-reduced-motion';
import { Icon, type IconName } from '../primitives/icon';
import { StatusDot, type StatusDotProps } from '../primitives/status-dot';
import './workbench-tabs.css';

/** The lamp's own vocabulary, derived from the primitive (never imported from the wire). */
type WorkbenchStatus = StatusDotProps['status'];

/** A session tab leads with its lamp; every other kind with its icon at 16. */
export type WorkbenchTabLead = { status: WorkbenchStatus; asleep?: boolean } | { icon: IconName };

export interface WorkbenchTabItem {
  id: string;
  /** The session's or the screen's name, never a raw id. */
  title: string;
  lead: WorkbenchTabLead;
  /** A kind tag after the title, e.g. `preview`. */
  tag?: string | null;
  /** The Fleet tab: first, caret only, no close, not draggable, sticky at the left. */
  pinned?: boolean;
}

export interface WorkbenchTabsProps {
  tabs: readonly WorkbenchTabItem[];
  activeId: string;
  onActivate: (id: string) => void;
  /** `nextActiveId` is `nextAfterClose(...)`: what the app should activate, or null when nothing is left. */
  onClose: (id: string, nextActiveId: string | null) => void;
  /** Absent: no tab is draggable. `after` is whether the drop landed on the target's right half. */
  onReorder?: (fromId: string, toId: string, after: boolean) => void;
  /** The "all tabs" control and the switcher; the app opens its palette or a sheet. */
  onShowAll?: () => void;
  /** `switcher` is the phone header's: the active title and the open count, one button. */
  variant?: 'strip' | 'switcher';
  /** The tablist's name. Default "Open tabs". */
  label?: string;
}

/** Closing `id`: its right neighbour, or its left one at the end; unchanged when `id` is not active. Pure. */
export function nextAfterClose(tabs: readonly WorkbenchTabItem[], id: string, activeId: string): string | null {
  if (id !== activeId) return activeId;
  const i = tabs.findIndex((t) => t.id === id);
  if (i < 0) return activeId;
  const next = tabs[i + 1] ?? tabs[i - 1];
  return next === undefined ? null : next.id;
}

const allTabsName = (n: number): string => `All tabs, ${n} open`;

function Lead({ lead }: { lead: WorkbenchTabLead }): ReactNode {
  return 'status' in lead ? (
    <StatusDot status={lead.status} asleep={lead.asleep} />
  ) : (
    <span className="wb-tabs-lead">
      <Icon name={lead.icon} size={16} />
    </span>
  );
}

/** The cut edge's fade: `start` sits just after the pinned Fleet tab, `end`
 *  before the "all tabs" control. Shown only while that edge is cut. */
function Fade({ edge, pinned }: { edge: 'start' | 'end'; pinned?: boolean }): ReactNode {
  return <span className="wb-tabs-fade" data-edge={edge} data-pinned={pinned ? 'true' : undefined} aria-hidden="true" />;
}

function Count({ n }: { n: number }): ReactNode {
  return (
    <span className="wb-tabs-count" aria-hidden="true">
      {n}
    </span>
  );
}

export function WorkbenchTabs({ variant = 'strip', ...rest }: WorkbenchTabsProps): ReactNode {
  return variant === 'switcher' ? <Switcher {...rest} /> : <Strip {...rest} />;
}

function Switcher({ tabs, activeId, onShowAll }: Omit<WorkbenchTabsProps, 'variant'>): ReactNode {
  const active = tabs.find((t) => t.id === activeId);
  return (
    <button type="button" className={cn('wb-tabs-switch', FOCUS_RING)} onClick={() => onShowAll?.()}>
      {active && <Lead lead={active.lead} />}{' '}
      <span className="wb-tabs-title">{active?.title ?? ''}</span>{' '}
      <span className="sr-only">{allTabsName(tabs.length)}</span>
      <Count n={tabs.length} />
    </button>
  );
}

type Drop = { id: string; after: boolean } | null;

/** What the scroller measures: does it overflow, and is anything cut at each edge. */
interface Scroll { overflowing: boolean; start: boolean; end: boolean }
const UNSCROLLED: Scroll = { overflowing: false, start: false, end: false };

/** Pure: the scroller's three facts from its geometry. A pixel of slack, for sub-pixel widths. */
function measureScroll(scrollLeft: number, scrollWidth: number, clientWidth: number): Scroll {
  const max = scrollWidth - clientWidth;
  if (max <= 1) return UNSCROLLED;
  return { overflowing: true, start: scrollLeft > 1, end: scrollLeft < max - 1 };
}

function Strip({ tabs, activeId, onActivate, onClose, onReorder, onShowAll, label = 'Open tabs' }: Omit<WorkbenchTabsProps, 'variant'>): ReactNode {
  const scrollRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());
  const dragFrom = useRef<string | null>(null);
  const focusActiveNext = useRef(false);
  const shownId = useRef<string | null>(null);
  const [scroll, setScroll] = useState<Scroll>(UNSCROLLED);
  const [drop, setDrop] = useState<Drop>(null);
  const { overflowing } = scroll;

  // Overflow and the cut edges are measured, never guessed: re-read whenever the
  // tabs change, on every scroll, and on every resize where a ResizeObserver
  // exists (jsdom has none). An unchanged answer keeps the same state object.
  const measure = (): void => {
    const el = scrollRef.current;
    if (!el) return;
    const next = measureScroll(el.scrollLeft, el.scrollWidth, el.clientWidth);
    setScroll((was) =>
      was.overflowing === next.overflowing && was.start === next.start && was.end === next.end ? was : next);
  };
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [tabs]); // `measure` reads only the ref and a setter, so it is no dependency.

  // Keep the active tab — its close control included — in view. Run again when
  // the overflow flips: the "all tabs" control mounts then and narrows the
  // scroller, and a scroll measured before it would leave the active tab's end
  // under it. A new active tab scrolls smoothly (instantly under reduced
  // motion); the first mount and a re-run for the overflow jump.
  useLayoutEffect(() => {
    const moved = shownId.current !== null && shownId.current !== activeId;
    shownId.current = activeId;
    tabRefs.current.get(activeId)?.parentElement?.scrollIntoView?.({
      block: 'nearest',
      inline: 'nearest',
      behavior: moved && !prefersReducedMotion() ? 'smooth' : 'auto',
    });
  }, [activeId, overflowing]);

  // A keyboard close removes the focused tab; focus follows to the tab the app
  // made active — but only when the close actually took focus away, so a close
  // the app declined never steals focus later.
  useEffect(() => {
    if (!focusActiveNext.current) return;
    focusActiveNext.current = false;
    const lost = document.activeElement === null || document.activeElement === document.body;
    if (lost) tabRefs.current.get(activeId)?.focus();
  }, [tabs, activeId]);

  const close = (id: string): void => onClose(id, nextAfterClose(tabs, id, activeId));

  const move = (to: WorkbenchTabItem | undefined): void => {
    if (!to) return;
    tabRefs.current.get(to.id)?.focus();
    onActivate(to.id);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, i: number): void => {
    const n = tabs.length;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      move(tabs[(i + (e.key === 'ArrowRight' ? 1 : -1) + n) % n]);
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      move(tabs[e.key === 'Home' ? 0 : n - 1]);
    } else if (e.key === 'Delete') {
      const t = tabs[i];
      if (!t || t.pinned) return;
      e.preventDefault();
      focusActiveNext.current = true;
      close(t.id);
    }
  };

  const canDrag = onReorder !== undefined;
  const dropSide = (e: DragEvent<HTMLElement>): boolean => {
    const r = e.currentTarget.getBoundingClientRect();
    return e.clientX > r.left + r.width / 2;
  };
  const dragProps = (t: WorkbenchTabItem) =>
    !canDrag || t.pinned
      ? {}
      : {
          onDragStart: (e: DragEvent<HTMLButtonElement>) => {
            dragFrom.current = t.id;
            // Firefox starts no drag without data.
            e.dataTransfer?.setData('text/plain', t.title);
            if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
          },
          onDragOver: (e: DragEvent<HTMLButtonElement>) => {
            if (dragFrom.current === null || dragFrom.current === t.id) return;
            e.preventDefault();
            const after = dropSide(e);
            if (drop?.id !== t.id || drop.after !== after) setDrop({ id: t.id, after });
          },
          onDragLeave: () => setDrop(null),
          onDrop: (e: DragEvent<HTMLButtonElement>) => {
            const from = dragFrom.current;
            dragFrom.current = null;
            setDrop(null);
            if (from === null || from === t.id) return;
            e.preventDefault();
            onReorder(from, t.id, dropSide(e));
          },
          onDragEnd: () => {
            dragFrom.current = null;
            setDrop(null);
          },
        };

  return (
    <div className="wb-tabs">
      <div ref={scrollRef} className="wb-tabs-scroll" role="tablist" aria-label={label} onScroll={measure}>
        {tabs.map((t, i) => {
          const on = t.id === activeId;
          return (
            <div
              key={t.id}
              role="none"
              className="wb-tabs-item"
              data-active={on ? 'true' : undefined}
              data-pinned={t.pinned ? 'true' : undefined}
              data-drop={drop?.id === t.id ? (drop.after ? 'after' : 'before') : undefined}
            >
              <button
                ref={(el) => {
                  if (el) tabRefs.current.set(t.id, el);
                  else tabRefs.current.delete(t.id);
                }}
                type="button"
                role="tab"
                aria-selected={on}
                tabIndex={on ? 0 : -1}
                aria-label={t.pinned ? t.title : undefined}
                aria-keyshortcuts={t.pinned ? undefined : 'Delete Alt+W'}
                draggable={!t.pinned && canDrag}
                className={cn('wb-tabs-tab', FOCUS_RING)}
                onClick={() => onActivate(t.id)}
                onKeyDown={(e) => onKeyDown(e, i)}
                {...dragProps(t)}
              >
                {t.pinned ? (
                  <span className="wb-tabs-caret" aria-hidden="true">
                    ❯
                  </span>
                ) : (
                  <>
                    <Lead lead={t.lead} />{' '}
                    <span className="wb-tabs-title">{t.title}</span>
                    {t.tag ? (
                      <>
                        {' '}
                        <span className="wb-tabs-tag">{t.tag}</span>
                      </>
                    ) : null}
                  </>
                )}
              </button>
              {!t.pinned && (
                <button
                  type="button"
                  tabIndex={-1}
                  aria-hidden="true"
                  title={`Close ${t.title}`}
                  className={cn('wb-tabs-close', FOCUS_RING)}
                  onClick={() => close(t.id)}
                >
                  <Icon name="x" size={16} />
                </button>
              )}
            </div>
          );
        })}
      </div>
      {scroll.start && <Fade edge="start" pinned={tabs[0]?.pinned === true} />}
      {scroll.end && <Fade edge="end" />}
      {overflowing && onShowAll && (
        <button
          type="button"
          className={cn('wb-tabs-all', FOCUS_RING)}
          aria-label={allTabsName(tabs.length)}
          onClick={onShowAll}
        >
          <Count n={tabs.length} />
          <Icon name="chevron-down" size={16} />
        </button>
      )}
    </div>
  );
}
