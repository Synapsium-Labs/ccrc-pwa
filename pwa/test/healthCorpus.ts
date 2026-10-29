// The `GET /health` answers W7 C7g's two cap readers are held to (D-7185, D-7485): `lib/serverCaps.ts#advertisesQuestions`
// (`answer-questions-door.test.ts`) and the reader rendered into `public/push-sw.js`'s generated region from it
// (`push-sw.test.ts`). One corpus, so the two readers cannot drift.
import { SERVER_CAPS } from '../../shared/api';

/** The `/health` answers both readers (this module and push-sw.js's rendered copy) are held to. */
export const HEALTH_CORPUS: ReadonlyArray<readonly [name: string, body: unknown, advertises: boolean]> = [
  ['the word among others', { ok: true, build: null, caps: ['dispatch-live-gate-v1', 'questions-v1'] }, true],
  ['the word alone', { ok: true, caps: ['questions-v1'] }, true],
  ['every word this server advertises', { ok: true, caps: SERVER_CAPS }, true],
  ['no caps field (an older server)', { ok: true, build: null }, false],
  ['caps without the word', { ok: true, caps: ['dispatch-live-gate-v1', 'hook-main-state-v1', 'ask-pairing-v1'] }, false],
  ['an empty list', { ok: true, caps: [] }, false],
  ['caps not a list', { ok: true, caps: 'questions-v1' }, false],
  ['caps an object', { ok: true, caps: { 'questions-v1': true } }, false],
  ['a word that only starts with it', { ok: true, caps: ['questions-v10'] }, false],
  ['a body that is not an object', 'questions-v1', false],
  ['null', null, false],
];
