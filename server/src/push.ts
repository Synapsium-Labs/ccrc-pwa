// Web Push — phone notifications when a session needs you (a question, or work
// finished). Subscriptions are ccrc-local state (this box's disk, not fleet
// state), so this uses node:fs directly rather than FleetIO. Dead endpoints
// (404/410) are pruned on send.
import webpush, { type PushSubscription, WebPushError } from 'web-push';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

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
}

export class PushService {
  private subs = new Map<string, PushSubscription>(); // keyed by endpoint
  private loaded = false;

  constructor(private cfg: PushConfig, private storePath: string) {
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

  async notify(payload: PushPayload): Promise<void> {
    await this.ensureLoaded();
    if (this.subs.size === 0) return;
    const body = JSON.stringify(payload);
    let pruned = false;
    await Promise.all(
      [...this.subs.values()].map(async (sub) => {
        try {
          await webpush.sendNotification(sub, body, { TTL: 600 });
        } catch (e) {
          // 404/410 = the browser dropped the subscription; forget it.
          if (e instanceof WebPushError && (e.statusCode === 404 || e.statusCode === 410)) {
            this.subs.delete(sub.endpoint);
            pruned = true;
          }
        }
      }),
    );
    if (pruned) await this.persist();
  }
}
