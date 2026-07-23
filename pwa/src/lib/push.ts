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

export type EnableResult = 'enabled' | 'denied' | 'unsupported' | 'unconfigured' | 'error';

export async function enablePush(): Promise<EnableResult> {
  if (!pushSupported()) return 'unsupported';
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return 'denied';
  try {
    const reg = await navigator.serviceWorker.ready;
    const keyRes = await fetch('/api/push/key');
    if (keyRes.status === 501) return 'unconfigured';
    if (!keyRes.ok) return 'error';
    const { key } = (await keyRes.json()) as { key: string };
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key) as unknown as BufferSource,
      });
    }
    const res = await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(sub),
    });
    return res.ok ? 'enabled' : 'error';
  } catch {
    return 'error';
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
