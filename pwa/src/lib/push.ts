// Client-side Web Push: permission + subscription lifecycle against the
// server's /api/push/* routes. Same-origin fetch — the PWA is served by ccrc.

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

export function pushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

/** True when this browser is both subscribed AND has notification permission. */
export async function pushEnabled(): Promise<boolean> {
  if (!pushSupported()) return false;
  if (Notification.permission !== 'granted') return false;
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return sub != null;
}

// 'pushservice' = the browser accepted permission but the push *transport* is
// unavailable. Brave is the usual culprit: it disables Google's push messaging
// by default, so pushManager.subscribe() rejects with AbortError even though
// permission was granted. Distinguished so the UI can point at the setting.
export type EnableStatus =
  | 'enabled'
  | 'denied'
  | 'unsupported'
  | 'unconfigured'
  | 'pushservice'
  | 'error';

export interface EnableResult {
  status: EnableStatus;
  detail?: string; // human-readable cause, surfaced in the UI + console
}

/** Compact, readable text for a thrown value (DOMException name+message, etc.). */
export function errText(e: unknown): string {
  if (e instanceof Error) return e.name ? `${e.name}: ${e.message}` : e.message;
  return String(e);
}

export async function enablePush(): Promise<EnableResult> {
  if (!pushSupported()) return { status: 'unsupported' };
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return { status: 'denied' };
  try {
    const reg = await navigator.serviceWorker.ready;
    const keyRes = await fetch('/api/push/key');
    if (keyRes.status === 501) return { status: 'unconfigured' };
    if (!keyRes.ok) return { status: 'error', detail: `key endpoint ${keyRes.status}` };
    const { key } = (await keyRes.json()) as { key: string };
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      try {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(key) as unknown as BufferSource,
        });
      } catch (e) {
        // subscribe() failed despite granted permission → the push transport is
        // blocked (Brave's Google-push toggle off, a proxied/embedded browser,
        // or aggressive Shields). Attribute it distinctly.
        const detail = errText(e);
        console.warn('[ccrc push] subscribe failed:', detail);
        return { status: 'pushservice', detail };
      }
    }
    const res = await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(sub),
    });
    return res.ok ? { status: 'enabled' } : { status: 'error', detail: `subscribe endpoint ${res.status}` };
  } catch (e) {
    const detail = errText(e);
    console.warn('[ccrc push] enable failed:', detail);
    return { status: 'error', detail };
  }
}

export async function disablePush(): Promise<void> {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await fetch('/api/push/unsubscribe', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ endpoint: sub.endpoint }),
  }).catch(() => {});
  await sub.unsubscribe().catch(() => {});
}
