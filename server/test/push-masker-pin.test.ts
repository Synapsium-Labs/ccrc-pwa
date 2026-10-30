// D-7510 (ring-exemption drain, server half, Task RS7; D-5513, D-5995): the push service masks every payload before
// it serializes it, with the shape-only masker from construction on and with the wired masker once the composition
// root hands it in. Every row builds its service through ONE local factory, `pushUnderTest()`, so the commit that gives
// the constructor its masker parameter edits the factory and not the rows (the plan's factory exception).
//
// Every credential here is ASSEMBLED at run time from neutral filler, so no file in the tree holds a whole shape.
import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import path from 'node:path';

const sent = vi.hoisted(() => [] as string[]);
vi.mock('web-push', () => {
  class WebPushError extends Error { statusCode = 0; }
  return {
    default: { setVapidDetails: () => {}, sendNotification: async (_s: unknown, body: string) => { sent.push(body); } },
    WebPushError,
  };
});

import { PushService, type PushPayload } from '../src/push.js';
import { SecretMasker, fingerprintGeneration, fingerprintRow } from '../src/accounts/mask.js';
import { openCoordDb } from '../src/coord/db.js';
import { SECRET_MASK } from '../../shared/api.js';
import { mkTmp } from './tmpHelpers.js';

const fill = (n: number, salt: string, alphabet = 'base64url'): string => {
  let s = '';
  for (let i = 0; s.length < n; i++) {
    s += createHash('sha256').update(`${salt}:${i}`).digest(alphabet === 'hex' ? 'hex' : 'base64url');
  }
  return s.slice(0, n);
};
const SK = 'sk';
const OAT = [SK, 'ant', 'oat01', fill(95, 'oat')].join('-');
const ORKEY = [SK, 'or', 'v1', fill(64, 'or', 'hex')].join('-');
/** A `compatible` key: no shape at all, so only a masker holding its fingerprint masks it. */
const CMP = `cmp-${fill(20, 'c1', 'hex')}-${fill(20, 'c2', 'hex')}`;
const TOKEN = 'a1'.repeat(32);

const CFG = { publicKey: 'p', privateKey: 'k', subject: 'mailto:ops@example.invalid' };
const SUB = { endpoint: 'https://push.example.invalid/1', keys: { p256dh: 'x', auth: 'y' } };

/** The one place a row builds its service. */
const pushUnderTest = async (): Promise<PushService> => {
  const storePath = path.join(mkTmp('ccrc-push-masker-'), '.ccrc', 'push-subs.json');
  const push = new PushService(CFG, storePath);
  await push.subscribe(SUB);
  sent.length = 0;
  return push;
};

/** The wired masker: a coord.db holding `CMP`'s fingerprint, recording what it is handed. */
class WiredMasker extends SecretMasker {
  readonly seen: unknown[] = [];
  override maskDeep<T>(value: T): T {
    this.seen.push(value);
    return super.maskDeep(value);
  }
}
const wiredMasker = (): WiredMasker => {
  const db = openCoordDb(path.join(mkTmp('ccrc-push-masker-db-'), 'coord.db'));
  const m = new WiredMasker({ db, token: () => TOKEN });
  m.ingest({ gen: fingerprintGeneration(TOKEN), rows: [fingerprintRow(TOKEN, 'lane0', CMP)] });
  return m;
};

const payload = (): PushPayload => ({
  title: `ask ${OAT}`,
  body: `paste ${ORKEY} or ${CMP}`,
  sessionId: 'claude-a-demo',
  tag: 'ask',
  actions: [{ action: 'a', title: OAT }, { action: 'b', title: `use ${CMP}` }],
});

describe('the push service masks every payload before it serializes it (D-7510, D-5513)', () => {
  it('a payload holding a credential shape is sent masked before setMasker', async () => {
    const push = await pushUnderTest();
    const p = payload();
    await push.notify(p);
    expect(sent).toHaveLength(1);
    const body = sent[0]!;
    expect(body).not.toContain(OAT);
    expect(body).not.toContain(ORKEY);
    expect(body).toContain(SECRET_MASK);
    // the shape-only pass: a key with no shape is not known to it, and the sent body is that pass's serialization
    expect(body).toContain(CMP);
    expect(body).toBe(JSON.stringify(new SecretMasker().maskDeep(p)));
  });

  it('after setMasker the wired masker masks the payload, handed the payload itself and not its serialization', async () => {
    const push = await pushUnderTest();
    const wired = wiredMasker();
    push.setMasker(wired);
    const p = payload();
    await push.notify(p);
    expect(sent).toHaveLength(1);
    const body = sent[0]!;
    expect(body).not.toContain(OAT);
    expect(body).not.toContain(ORKEY);
    expect(body).not.toContain(CMP);
    expect(body).toContain(SECRET_MASK);
    expect(wired.seen).toEqual([p]);
    expect(body).toBe(JSON.stringify(wired.maskDeep(p)));
  });

  it('the sent body is JSON.stringify of the masked payload: a payload with nothing to mask is sent byte for byte', async () => {
    const push = await pushUnderTest();
    const p: PushPayload = { title: 'Question', body: 'Pick one', sessionId: 'claude-a-demo', tag: 't', url: '/s/claude-a-demo',
      actions: [{ action: 'a', title: 'Yes' }] };
    await push.notify(p);
    expect(sent).toEqual([JSON.stringify(p)]);
  });
});
