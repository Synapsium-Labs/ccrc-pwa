// The renderer of `public/push-sw.js`'s generated region (W7 C7e Step 7, D-7183; OA-C17 (a), D-7265, recorded in
// `docs/superpowers/plans/2026-10-28-w7-operator-acts-ruled.md`). `push-sw.js` is a classic script the service worker
// `importScripts`, so it cannot import the answer lifecycle; the two things it shares with it are rendered here as
// source text and held byte-equal by `push-sw.test.ts`:
//  - the request, `askRequestOf(action, sessionId)`, rendered from `answerLifecycle.ts#ASK_REQUEST`, the `ask` arm's
//    declared shape that `answerRequest` also reads (a row evaluates both over one action corpus and holds them equal,
//    so the text never depends on how a bundler prints a function);
//  - the sentence table, `REFUSAL`, rendered from `refusalWords.ts#NOTIFICATION_REFUSAL_TEXT`.
// A test-side module, not a `pwa/scripts/*.mjs`: it ships in no bundle and runs only inside vitest.
import { ASK_REQUEST } from '../src/session/answerLifecycle';
import { NOTIFICATION_REFUSAL_TEXT } from '../src/lib/refusalWords';

export const REGION_BEGIN = '// ccrc:generated answer-lifecycle BEGIN';
export const REGION_END = '// ccrc:generated answer-lifecycle END';

/** A single-quoted JS string literal for `s`. */
const quoted = (s: string): string => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

function actionRegex(): string {
  if (ASK_REQUEST.actionPattern.includes('/')) throw new Error('ASK_REQUEST.actionPattern holds a "/": render it with new RegExp');
  return `/${ASK_REQUEST.actionPattern}/`;
}

/** The region's text, markers included, ending in a newline. */
export function renderAnswerRegion(): string {
  const table = Object.entries(NOTIFICATION_REFUSAL_TEXT).map(([k, v]) => `  ${quoted(k)}: ${quoted(v)},`);
  return [
    REGION_BEGIN,
    '// Rendered by pwa/test/answerRegion.ts from pwa/src/session/answerLifecycle.ts#ASK_REQUEST and',
    '// pwa/src/lib/refusalWords.ts#NOTIFICATION_REFUSAL_TEXT; push-sw.test.ts holds it byte-equal. Never edit it by hand:',
    '// change the source, then run `CCRC_WRITE_ANSWER_REGION=1 npx vitest run test/push-sw.test.ts` in pwa/.',
    '',
    '/**',
    ' * One sentence per refusal `POST /api/sessions/:id/ask` can return, rendered beside the code that shows them because',
    ' * the operator reads them with no app open and no way to ask a follow-up question. The table and why its set is the',
    " * route's own union are in `refusalWords.ts#NOTIFICATION_REFUSAL_TEXT`. An unlisted token falls back to the generic",
    ' * sentence rather than showing the operator a bare error code.',
    ' */',
    'const REFUSAL = {',
    ...table,
    '};',
    '',
    '/**',
    ' * The request the notification action "ask:<key>:<index>" sends for session `sessionId`, or null when the action is',
    ' * not one (or there is no session): then nothing is sent and the app opens. The key is minted server-side and carried',
    ' * verbatim; the index is a number, never derived from a label, because a relabelled or reordered option would then',
    ' * silently answer a different question.',
    ' */',
    'function askRequestOf(action, sessionId) {',
    `  const m = ${actionRegex()}.exec(action);`,
    '  if (m === null || sessionId === null) return null;',
    '  return {',
    `    method: ${quoted(ASK_REQUEST.method)},`,
    `    path: ${quoted(ASK_REQUEST.pathPrefix)} + encodeURIComponent(sessionId) + ${quoted(ASK_REQUEST.pathSuffix)},`,
    `    headers: { 'content-type': ${quoted(ASK_REQUEST.contentType)} },`,
    `    body: JSON.stringify({ ${ASK_REQUEST.keyField}: m[1], ${ASK_REQUEST.indexesField}: [Number(m[2])] }),`,
    '  };',
    '}',
    REGION_END,
    '',
  ].join('\n');
}

/** The region as it stands in `src`, markers included, or null when `src` has none. */
export function answerRegionOf(src: string): string | null {
  const b = src.indexOf(REGION_BEGIN);
  if (b < 0) return null;
  const e = src.indexOf(REGION_END, b);
  if (e < 0) return null;
  const end = src.indexOf('\n', e);
  return src.slice(b, end < 0 ? src.length : end + 1);
}

/** `src` with its region replaced by a fresh render. A source without one is refused: where the region sits in the
 *  worker is a hand-written decision, made once. */
export function applyAnswerRegion(src: string): string {
  const old = answerRegionOf(src);
  if (old === null) throw new Error('push-sw.js has no ccrc:generated answer-lifecycle region');
  return src.replace(old, () => renderAnswerRegion());
}
