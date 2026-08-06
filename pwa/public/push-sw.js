// Web Push handlers, importScripts'd into the generated service worker
// (vite.config.ts workbox.importScripts). Shows the notification, deep-links to
// the session on tap, and — when the payload carries them — offers the ask's
// first options as notification actions that answer it outright.
/* global self, fetch */

/**
 * One sentence per refusal `POST /api/sessions/:id/ask` can return, kept here
 * beside the code that renders them because the operator reads them with no app
 * open and no way to ask a follow-up question.
 *
 * The set is the route's own union (`server/src/inject/ask.ts`), not a subset:
 * `multiselect` and `duplicate-index` cannot be produced by a one-index tap
 * today, but they stay because the route owns that union and a future action
 * shape could send more than one index. An unlisted token falls back to the
 * generic sentence rather than showing the operator a bare error code.
 */
const REFUSAL = {
  'stale-ask': 'That question is gone.',
  'not-waiting': 'The session has moved on.',
  'ask-mismatch': 'The question changed — open the session and read it.',
  'multi-question': 'This one asks more than one thing — open the session.',
  'multiselect': 'This one takes more than one answer — open the session.',
  'duplicate-index': 'That option was sent twice — open the session.',
  'range': 'That option is no longer there.',
  'no-menu': 'The question is no longer on screen.',
  'menu-mismatch': 'The terminal is showing something else now.',
  'not-alive': 'That session is no longer running.',
  'unknown-session': 'That session is gone.',
};

const ICON = '/icons/icon-192.png';

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'ccrc', body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'ccrc';
  // Capped at two here as well as server-side. The ceiling is the platform's
  // (Android shows two), and a payload that somehow carried more would have the
  // extras silently dropped by the browser anyway — better to drop them where
  // the reason is written down.
  const actions = Array.isArray(data.actions) ? data.actions.slice(0, 2) : [];
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '',
      tag: data.tag,
      renotify: Boolean(data.tag),
      icon: ICON,
      badge: ICON,
      actions,
      // The actions are mirrored into `data` because `notification.actions` is
      // not readable on every platform, and the click handler needs the tapped
      // action's LABEL to say what it just answered.
      data: { sessionId: data.sessionId || null, actions },
    }),
  );
});

/** Open (or focus) the app at `url`. The original tap behaviour, unchanged. */
async function openApp(url) {
  const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const c of wins) {
    if ('focus' in c) {
      try {
        await c.navigate(url);
      } catch {
        /* cross-origin or unsupported — fall through to focus */
      }
      return c.focus();
    }
  }
  if (self.clients.openWindow) return self.clients.openWindow(url);
  return undefined;
}

/** Replace the notification the operator just tapped, keeping its tag so the
 *  reply lands in the same slot rather than stacking underneath. */
function replace(title, body, sessionId, tag) {
  return self.registration.showNotification(title, {
    body, tag, icon: ICON, badge: ICON, data: { sessionId },
  });
}

/** The tapped action's own label, for the confirmation. Reads the platform's
 *  copy when it exposes one, else the mirror we put in `data`. */
function labelFor(notification, action) {
  const lists = [notification.actions, notification.data && notification.data.actions];
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    const hit = list.find((a) => a && a.action === action);
    if (hit && hit.title) return hit.title;
  }
  return '';
}

self.addEventListener('notificationclick', (event) => {
  const action = event.action || '';
  const notification = event.notification;
  const sid = (notification.data && notification.data.sessionId) || null;
  const url = sid ? `/s/${encodeURIComponent(sid)}` : '/';

  // "ask:<key>:<index>". The key is minted server-side and carried verbatim;
  // this worker never derives an index from a label, because a relabelled or
  // reordered option would then silently answer a different question.
  const m = /^ask:([^:]+):(\d+)$/.exec(action);
  if (m === null || sid === null) {
    notification.close();
    event.waitUntil(openApp(url));
    return;
  }

  notification.close();
  event.waitUntil((async () => {
    let res;
    try {
      res = await fetch(`/api/sessions/${encodeURIComponent(sid)}/ask`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ askKey: m[1], optionIndexes: [Number(m[2])] }),
      });
    } catch {
      // NEVER silently dropped — and never overclaimed either. A rejected
      // `fetch` proves only that the RESPONSE did not arrive: the POST may have
      // reached the server, passed every gate and pressed the digit, with the
      // connection dying (tunnel, handover, Tailscale re-key) before the reply
      // came back. "Still unanswered" would state the one thing nothing here
      // establishes, and an operator told the question is still waiting goes
      // looking for a menu that may be long gone — or, worse, believes one is
      // still up. Only the response can tell "never sent" from "sent and
      // applied", so say exactly that and leave the way back open.
      await replace("Couldn't confirm", 'No connection — tap to open the session.', sid, notification.tag);
      return;
    }

    if (res.ok) {
      const label = labelFor(notification, action);
      await replace('Answered', label, sid, notification.tag);
      return;
    }

    // The state moved between the push and the tap. Say WHICH hazard it was —
    // the route named it for exactly this — and leave the operator one tap from
    // the session, because a question they can no longer answer blind is a
    // question they should look at.
    let token = '';
    try {
      const body = await res.json();
      token = (body && body.error) || '';
    } catch {
      /* a refusal with no readable body still gets the generic sentence */
    }
    // The fallback names NO cause. "The session moved on" was a guess dressed
    // as a fact: this branch also catches a 502 from a proxy, a 500, an
    // unreadable body — cases where the session moved nowhere at all. The
    // status is the one thing the response really did say, so it is what gets
    // shown, and the tap that reaches the session is what answers the rest.
    await replace(
      "Couldn't answer",
      REFUSAL[token] || `No reason given (HTTP ${res.status}) — tap to open the session.`,
      sid,
      notification.tag,
    );
  })());
});
