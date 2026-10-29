// The PWA's one server-cap reader (W7 C7g, D-7185, D-7485; ARCH-57 #792, PWA half). It reads ONE word, `questions-v1`
// (W3 Q3f, D-7030: this server answers the `/api/questions/:id/*` family), from `GET /health`'s `caps`, which is
// ungated (the deploy's liveness probe, `server/src/auth/gate.ts`). The answer lifecycle asks it which door an
// operator's answer takes: the family's `POST /api/questions/session-<id>/answer` when the word is there, the old door
// otherwise. The old doors stay on every server as aliases until C7p, so "otherwise" is always answered.
//
// It matches the word: it never counts the list or compares it whole, so a server that adds a word of its own reads the
// same. `push-sw.js` cannot import this module (a classic script the service worker `importScripts`), so its generated
// region carries a reader rendered from `SERVER_CAPS_READ` (`pwa/test/answerRegion.ts`), held equal to
// `advertisesQuestions` over one corpus by `push-sw.test.ts`.
import type { ServerCap } from '../../../shared/api';

/** The one word this module reads. */
export const QUESTIONS_CAP = 'questions-v1' satisfies ServerCap;

/** The read's declared shape: where the words are, how the request is made (`no-store`: an answer cached by the
 *  browser across a server's rollback would name a door that server no longer has), and the word. `push-sw.js`'s
 *  rendered reader is built from these three. */
export const SERVER_CAPS_READ = { path: '/health', cache: 'no-store', word: QUESTIONS_CAP } as const;

/** How long a read that answered is held before the next answer reads again. */
export const SERVER_CAPS_HOLD_MS = 60_000;

/** Does a `GET /health` answer advertise `questions-v1`? A body that is not an object, or a `caps` that is not a list,
 *  advertises nothing. */
export function advertisesQuestions(health: unknown): boolean {
  if (typeof health !== 'object' || health === null) return false;
  const caps = (health as { caps?: unknown }).caps;
  return Array.isArray(caps) && caps.includes(SERVER_CAPS_READ.word);
}

export interface ServerCaps {
  /** True when this server advertises `questions-v1`: the operator's answer takes the family's door. False when it
   *  does not, or when `/health` could not be read: the old door, which every server before C7p answers. */
  questionsDoor(): Promise<boolean>;
}

/** One reader over `fetchImpl`. A read that answered (200 with a JSON body) is held for `SERVER_CAPS_HOLD_MS`, by
 *  `now`'s clock; a request that failed, a non-200 or an unreadable body reads as false and is NOT held, so the next
 *  answer reads again. Answers made while a read is under way share it. */
export function createServerCaps(fetchImpl: typeof fetch, now: () => number = () => Date.now()): ServerCaps {
  let held: { at: number; door: boolean } | null = null;
  let reading: Promise<boolean> | null = null;
  const read = async (): Promise<boolean> => {
    try {
      const res = await fetchImpl(SERVER_CAPS_READ.path, { cache: SERVER_CAPS_READ.cache });
      if (!res.ok) return false;
      const door = advertisesQuestions(await res.json());
      held = { at: now(), door };
      return door;
    } catch {
      return false;
    }
  };
  return {
    questionsDoor: () => {
      if (held !== null && now() - held.at < SERVER_CAPS_HOLD_MS) return Promise.resolve(held.door);
      reading ??= read().finally(() => { reading = null; });
      return reading;
    },
  };
}
