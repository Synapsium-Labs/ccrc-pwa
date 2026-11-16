// Web Push — phone notifications when a session needs you (a question, or work
// finished). Subscriptions are ccrc-local state (this box's disk, not fleet
// state), so this uses node:fs directly rather than FleetIO. Dead endpoints
// (404/410) are pruned on send.
import webpush, { type PushSubscription, WebPushError } from 'web-push';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { OUTBOX_SUB_TIMEOUT_MS, type PushSendVerdict, type SubscriptionVerdict } from '../../shared/push-outbox.js';

export interface PushConfig {
  publicKey: string;
  privateKey: string;
  subject: string; // "mailto:you@example.com" or a https URL, per the VAPID spec
}

export interface PushPayload {
  title: string;
  body: string;
  sessionId?: string; // deep-link target; the SW opens /s/<id>
  tag?: string; // collapse key so repeats of the same event replace, not stack
  url?: string; // a same-origin path the SW opens on tap, ahead of /s/<sessionId>
  /** Up to TWO — the platform ceiling on Android, and the reason the ask push
   *  sends the first two option labels and deep-links for the rest. Ignored by
   *  an older service worker, which simply shows the notification. */
  actions?: { action: string; title: string }[];
  /** The outbox row's push id (Overlord W1, C67): set by the sender at the send, from the row, only when the push's
   *  response row stands; read by the service worker's receipts. Not text, and never stored in the outbox's payload. */
  pushId?: string;
}

/** What the service masks a payload with: `SecretMasker`'s `maskDeep`, declared here so `push.ts` loads no masker
 *  (D-7510). The composition root passes the shape-only masker at construction. */
export interface PayloadMasker {
  maskDeep<T>(value: T): T;
}

export class PushService {
  private subs = new Map<string, PushSubscription>(); // keyed by endpoint
  private loaded = false;
  /** Every payload's `title`, `body` and action titles came off a session (the pane-parsed ask, a mail subject): masked
   *  here, the one door to a push service, before serialization (D-5513, accounts plan Task A10). The composition root
   *  builds the service with the shape-only masker and hands the wired one in with `setMasker`, since the service is
   *  built before coord.db is open (D-7510). */
  setMasker(m: PayloadMasker): void { this.masker = m; }
  /** The masker `notify` masks with now (the shape-only one until `setMasker`): the outbox sender masks a payload it
   *  stores with this one until `Deps.masker` is set, so the row and the push carry the same bytes (Overlord W1). */
  get payloadMasker(): PayloadMasker { return this.masker; }

  constructor(private cfg: PushConfig, private storePath: string, private masker: PayloadMasker) {
    webpush.setVapidDetails(cfg.subject, cfg.publicKey, cfg.privateKey);
  }

  get publicKey(): string {
    return this.cfg.publicKey;
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw = JSON.parse(await readFile(this.storePath, 'utf8')) as PushSubscription[];
      for (const s of raw) if (s?.endpoint) this.subs.set(s.endpoint, s);
    } catch {
      /* no store yet — first run */
    }
  }

  private async persist(): Promise<void> {
    await mkdir(path.dirname(this.storePath), { recursive: true });
    const tmp = `${this.storePath}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify([...this.subs.values()]));
    const { rename } = await import('node:fs/promises');
    await rename(tmp, this.storePath);
  }

  async subscribe(sub: PushSubscription): Promise<void> {
    await this.ensureLoaded();
    this.subs.set(sub.endpoint, sub);
    await this.persist();
  }

  async unsubscribe(endpoint: string): Promise<void> {
    await this.ensureLoaded();
    if (this.subs.delete(endpoint)) await this.persist();
  }

  /** One send to every subscription, answering one verdict per subscription (Overlord W1, the push outbox, Task 3;
   *  slug verdict-ships-with-the-outbox). No subscription answers `no-subscription`. Each send carries a per-request
   *  `timeout` below the outbox's deadline. A 404 or 410 is pruned, as before, and answers `gone`. A failed prune write
   *  still rejects, as before; the sender reads a rejection as no verdict. The endpoint is kept only as its hex SHA-256. */
  async notify(payload: PushPayload): Promise<PushSendVerdict> {
    await this.ensureLoaded();
    if (this.subs.size === 0) return { kind: 'no-subscription' };
    const body = JSON.stringify(this.masker.maskDeep(payload));
    const opts = { TTL: 600, timeout: OUTBOX_SUB_TIMEOUT_MS };
    let pruned = false;
    const subs = await Promise.all(
      [...this.subs.values()].map(async (sub) => {
        const endpointHash = createHash('sha256').update(sub.endpoint).digest('hex');
        try {
          const res = await webpush.sendNotification(sub, body, opts);
          return { endpointHash, verdict: 'accepted' as const, status: typeof res?.statusCode === 'number' ? res.statusCode : null };
        } catch (e) {
          // 404/410 = the browser dropped the subscription; forget it.
          if (e instanceof WebPushError && (e.statusCode === 404 || e.statusCode === 410)) {
            this.subs.delete(sub.endpoint);
            pruned = true;
          }
          return { endpointHash, ...subscriptionVerdictOf(e, () => webpush.generateRequestDetails(sub, body, opts)) };
        }
      }),
    );
    if (pruned) await this.persist();
    return { kind: 'sent', subs };
  }
}

/** Errors raised before the request left the box: the service never saw it, so the refusal can pass and is retried. */
const BEFORE_SEND_CODES: ReadonlySet<string> = new Set(['ENOTFOUND', 'ECONNREFUSED', 'EAI_AGAIN', 'ENETUNREACH']);

/** One failed send's verdict. A `WebPushError` carries the service's status: 404 or 410 is `gone`, 400, 403 or 413
 *  `refused-for-good`, any other `refused`. An error raised before the request left the box is `refused`. Any other
 *  error is asked once more of web-push's own request builder (`rebuild`, which sends nothing): a build that throws
 *  means web-push refused the send on this box before any request existed (a stored subscription with bad keys), so it
 *  is `unsendable` and its row seals `failed` (review 2119 F10). Otherwise (a reset or a timeout after the write, a TLS
 *  failure, a connect `ETIMEDOUT`) it is `no-answer`, the safe side, because the service may have taken it (slug
 *  no-answer-is-never-retried). The rebuild runs only on this error path, never before a send. */
function subscriptionVerdictOf(e: unknown, rebuild: () => unknown): { verdict: SubscriptionVerdict; status: number | null } {
  if (e instanceof WebPushError) {
    const status = typeof e.statusCode === 'number' ? e.statusCode : null;
    if (status === 404 || status === 410) return { verdict: 'gone', status };
    if (status === 400 || status === 403 || status === 413) return { verdict: 'refused-for-good', status };
    return { verdict: 'refused', status };
  }
  const code = (e as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && BEFORE_SEND_CODES.has(code)) return { verdict: 'refused', status: null };
  try { rebuild(); } catch { return { verdict: 'unsendable', status: null }; }
  return { verdict: 'no-answer', status: null };
}
