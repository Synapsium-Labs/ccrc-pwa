// D-7406, D-7501 (plan docs/superpowers/plans/2026-10-29-test-box.md, Task TB4; spec §2.9 A). L1: the test service's
// `hello` check, to the fleet agent's contract (`agent/src/server.ts#handleConnection`): the first frame of a
// connection must be `{ t: 'hello', token }` with the service's bearer token, within the hello timeout, or the socket
// closes with code 4401 and the reason `unauthorized` or `hello-timeout`. It is a twin of the agent's inline check,
// kept here so the fleet agent's hot file is not edited for it; `agent/test/testbox-service.test.ts` pins both numbers
// against `agent/src/server.ts`'s own constants, so the two cannot drift. The comparison is constant-time over the
// digests (the agent compares with `!==`; the answer is the same, only the timing is not).
import { createHash, timingSafeEqual } from 'node:crypto';

/** The close code of a refused or late hello, the fleet agent's `AUTH_CLOSE_CODE`. */
export const AUTH_CLOSE_CODE = 4401;
/** The fleet agent's `DEFAULT_HELLO_TIMEOUT_MS`. */
export const DEFAULT_HELLO_TIMEOUT_MS = 3000;

export type HelloVerdict = 'ok' | 'unauthorized';

function isHelloShaped(msg: unknown): msg is { t: 'hello'; token: unknown } {
  return typeof msg === 'object' && msg !== null && (msg as { t?: unknown }).t === 'hello';
}

const digest = (s: string): Buffer => createHash('sha256').update(s, 'utf8').digest();

/** A connection's first frame, already parsed, against the service's token. Anything but a hello carrying exactly the
 *  token is `unauthorized`; an empty configured token never authorises. */
export function checkHello(msg: unknown, token: string): HelloVerdict {
  if (token === '' || !isHelloShaped(msg) || typeof msg.token !== 'string') return 'unauthorized';
  return timingSafeEqual(digest(msg.token), digest(token)) ? 'ok' : 'unauthorized';
}
