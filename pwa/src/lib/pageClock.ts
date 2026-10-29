// The page clock (D-7191; ARCH-75, #810): the ONE `visibilitychange` and the ONE `online` subscription in `pwa/src`.
// Every view, hook and store that acts when the page turns visible, turns hidden or comes back online subscribes
// here, and each subscription returns its stop. A document (or window) listener is added with its first subscriber
// and removed with its last stop, so a page with no subscriber holds none (the leak rows in
// `pwa/test/page-clock.test.ts`).
//
// The handler sets keep the DOM's own rules, so a handler moved here from its own `addEventListener` behaves as it
// did: the same handler subscribed twice to one event is held once, handlers run in the order they subscribed, a
// handler subscribed while the event is dispatched does not run for it, and one stopped before its turn does not run.
// A handler may still read `document.visibilityState` itself; it reads what it read before.

type Handler = () => void;
type Stop = () => void;

/** Run each handler still subscribed, over a snapshot taken when the event fired. */
const fanOut = (handlers: Set<Handler>): void => {
  for (const h of [...handlers]) if (handlers.has(h)) h();
};

// ─── visibilitychange: one listener for both directions ────────────────────────────────────────────────────────────
const visibleHandlers = new Set<Handler>();
const hiddenHandlers = new Set<Handler>();
const onVisibilityChange = (): void => {
  if (document.visibilityState === 'visible') fanOut(visibleHandlers);
  else if (document.visibilityState === 'hidden') fanOut(hiddenHandlers);
};
const visibilitySubscribers = (): number => visibleHandlers.size + hiddenHandlers.size;

function subscribeVisibility(handlers: Set<Handler>, handler: Handler): Stop {
  if (visibilitySubscribers() === 0) document.addEventListener('visibilitychange', onVisibilityChange);
  handlers.add(handler);
  return () => {
    if (!handlers.delete(handler)) return;
    if (visibilitySubscribers() === 0) document.removeEventListener('visibilitychange', onVisibilityChange);
  };
}

/** Run `handler` each time the page becomes visible; the returned function stops it. */
export function onPageVisible(handler: Handler): Stop {
  return subscribeVisibility(visibleHandlers, handler);
}

/** Run `handler` each time the page becomes hidden; the returned function stops it. */
export function onPageHidden(handler: Handler): Stop {
  return subscribeVisibility(hiddenHandlers, handler);
}

// ─── online ────────────────────────────────────────────────────────────────────────────────────────────────────────
const onlineHandlers = new Set<Handler>();
const onBackOnline = (): void => fanOut(onlineHandlers);

/** Run `handler` each time the browser comes back online; the returned function stops it. */
export function onOnline(handler: Handler): Stop {
  if (onlineHandlers.size === 0) window.addEventListener('online', onBackOnline);
  onlineHandlers.add(handler);
  return () => {
    if (!onlineHandlers.delete(handler)) return;
    if (onlineHandlers.size === 0) window.removeEventListener('online', onBackOnline);
  };
}
