# ccrc Composer Attachment Tray Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make an attached screenshot a visible, removable chip the PWA owns until you press send, instead of a path silently typed into the remote terminal.

**Architecture:** Move the commit point. `POST /upload` *stages* a file into `~/.cc-clips/<id>/` and returns its path without touching the session; `POST /prompt` grows `attachments[]` and injects paths + text in one atomic keystroke sequence. The PWA holds each staged image as a chip with an object-URL thumbnail. A new `GET /clip/:name` route serves the bytes back so sent messages render the image instead of a raw path.

**Tech Stack:** TypeScript, Fastify, React 19 + zustand, vitest (+ @testing-library/react, jsdom), bash (`ccd`).

**Spec:** [`docs/superpowers/specs/2026-07-26-ccrc-attachment-tray-design.md`](../specs/2026-07-26-ccrc-attachment-tray-design.md)

## Global Constraints

- **Run this plan before** `2026-07-26-ccrc-structured-ask.md`. They share `shared/api.ts`, `pwa/test/chat.test.tsx`, and the `ChatList` → `MessageBubble` signature.
- Three packages, each with its own suite. Always run from the package dir: `infra/ccrc/server`, `infra/ccrc/agent`, `infra/ccrc/pwa`. Command is `npx vitest run` (single file: `npx vitest run test/x.test.ts`).
- Baseline before you start: **server 173, agent 82, pwa 169 — all passing.** Never finish a task with fewer passing than you started.
- No new runtime dependencies in any package. The server has no image decoder and is not getting one.
- Max **4** attachments per prompt. Max **12 MB** per upload after downscale.
- Clip filenames are `clip-<YYYYmmdd-HHMMSS>-<rand8>.<ext>`, `ext ∈ {png, jpg, jpeg, webp}`.
- Every design token comes from `tokens.css` — components never hardcode a colour or size. New pairings must pass `node design/contrast-check.mjs` (currently 74/74).
- jsdom has **no canvas and no object URLs**. `createImageBitmap`, `URL.createObjectURL` and `URL.revokeObjectURL` must be stubbed in tests; the downscale is already injectable for this reason.
- Never `git add -A`. Stage the exact files listed in each task.

---

## File Structure

**Shared contract** — `infra/ccrc/shared/api.ts`
Gains `StagedClip`, `CLIP_PATH_RE`, `composePrompt`, `splitClipPaths`. This turns a
pure-type module into one carrying runtime code; it is imported by both the server
(Node ESM, `.js` suffixed imports) and the PWA (Vite).

**Server** — `infra/ccrc/server/src/`
- `clip.ts` — replaces `saveUploadAndClip` with `clipName` / `clipPath` / `stageUpload`. The containment assertion lives here, at the write site.
- `server.ts` — `isSafeSessionId` guard; upload route returns `StagedClip`; prompt route validates `attachments`; new `GET /api/sessions/:id/clip/:name`.
- `inject/send.ts` — `sendPrompt` takes `attachments`, composes via `composePrompt`, verifies the echo against the input box, and clears the box on `verify-failed`.
- `io.ts` / `remote/io.ts` — `readFileB64`.

**Agent** — `infra/ccrc/shared/agent-protocol.ts`, `infra/ccrc/agent/src/{server,fileops}.ts`
New `readB64` op so the clip route works in remote-fleet mode.

**PWA** — `infra/ccrc/pwa/src/`
- `lib/api.ts` — `upload` returns `StagedClip`; `prompt` takes an options object; new `clipUrl`.
- `session/useAttachImage.ts` — `useStagedImages` list hook; keeps `downscaleImage` / `namedClipboardImage`; `clipboardImage` → `clipboardImages`.
- `session/AttachTray.tsx` — **new**, the chips.
- `session/AttachButton.tsx` — stateless trigger.
- `session/Composer.tsx` — owns the hook, renders the tray, gates send, drag-and-drop.
- `stores/session.ts` — `attachments` on `PendingSend`; `resolve`; echo match via `composePrompt`.
- `session/ChatList.tsx`, `session/MessageBubble.tsx` — thumbnails, `id` threading.
- `session/chat.css`, `styles/tokens.css`, `components/primitives.css`, `screens/SessionScreen.tsx` — tray styling and the toast offset.

**Terminal** — `infra/<server-host>-portability/ccd`
`_clip_dest` helper so the Mac hotkey's naming is testable.

---

## Task 1: Shared contract — compose and split

**Files:**
- Modify: `infra/ccrc/shared/api.ts`
- Test: `infra/ccrc/pwa/test/compose.test.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: `interface StagedClip { path: string; name: string; bytes: number }`; `const CLIP_PATH_RE: RegExp`; `composePrompt(text: string, attachments: readonly string[]): string`; `splitClipPaths(text: string): { paths: string[]; rest: string }`.

- [ ] **Step 1: Write the failing test**

Create `infra/ccrc/pwa/test/compose.test.ts`:

```ts
// The prompt composition rule, shared so the server that types a prompt and the
// PWA that recognises its echo can never disagree — plus its inverse, which has
// to cope with `ccd clip` typing a path on either side of the user's prose.
import { describe, expect, it } from 'vitest';
import { composePrompt, splitClipPaths } from '../../shared/api';

const P1 = '/home/you/.cc-clips/claude2-OpenClawHetzner/clip-20260726-150340-a1b2.png';
const P2 = '/home/you/.cc-clips/claude2-OpenClawHetzner/clip-20260726-150341-c3d4.jpg';

describe('composePrompt', () => {
  it('puts each attachment on its own line above the text', () => {
    expect(composePrompt('look at this', [P1])).toBe(`${P1}\nlook at this`);
    expect(composePrompt('two', [P1, P2])).toBe(`${P1}\n${P2}\ntwo`);
  });

  it('is the identity when there are no attachments', () => {
    expect(composePrompt('plain text', [])).toBe('plain text');
  });

  it('omits the blank line when an image is sent with no text', () => {
    expect(composePrompt('', [P1])).toBe(P1);
  });
});

describe('splitClipPaths', () => {
  it('splits its own composed output back apart', () => {
    expect(splitClipPaths(composePrompt('look at this', [P1, P2]))).toEqual({
      paths: [P1, P2],
      rest: 'look at this',
    });
  });

  it('extracts a TRAILING path — what `ccd clip` produces when you type first', () => {
    // Verbatim from the transcript that motivated this feature.
    const raw =
      'Please make the handling of of screenshot attachments much nicer from a ' +
      `ui/ux perspective, what's there now is Poor ${P1}`;
    expect(splitClipPaths(raw)).toEqual({
      paths: [P1],
      rest:
        'Please make the handling of of screenshot attachments much nicer from a ' +
        "ui/ux perspective, what's there now is Poor",
    });
  });

  it('extracts a LEADING same-line path and eats ccd’s trailing space', () => {
    expect(splitClipPaths(`${P1} what is this`)).toEqual({ paths: [P1], rest: 'what is this' });
  });

  it('extracts a MID-line path without doubling the surrounding spaces', () => {
    expect(splitClipPaths(`before ${P1} after`)).toEqual({ paths: [P1], rest: 'before after' });
  });

  it('reports a repeated path once', () => {
    expect(splitClipPaths(`${P1} and again ${P1}`)).toEqual({ paths: [P1], rest: 'and again' });
  });

  it('leaves a non-clip absolute path as prose', () => {
    const raw = 'see /etc/hosts and /home/me/photo.png';
    expect(splitClipPaths(raw)).toEqual({ paths: [], rest: raw });
  });

  it('returns text-only input untouched', () => {
    expect(splitClipPaths('nothing here')).toEqual({ paths: [], rest: 'nothing here' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd infra/ccrc/pwa && npx vitest run test/compose.test.ts`
Expected: FAIL — `composePrompt is not a function` (no such export).

- [ ] **Step 3: Write minimal implementation**

Append to `infra/ccrc/shared/api.ts`:

```ts
/** A file staged into ~/.cc-clips/<id>/, ready to be named in a prompt. The
 *  server reports no dimensions — it has no image decoder, and never will. */
export interface StagedClip { path: string; name: string; bytes: number }

/**
 * A clip path anywhere in a string: `…/.cc-clips/<session>/clip-<stem>.<ext>`.
 * Matched by SHAPE, never by touching the filesystem, so it works client-side.
 */
export const CLIP_PATH_RE =
  /\/[^\s]*\/\.cc-clips\/[^/\s]+\/clip-[A-Za-z0-9._-]+\.(?:png|jpe?g|webp)/g;

/** Attachment paths first, each on its own line, then the user's text. Paths
 *  lead so the transcript reads image-above-caption. */
export function composePrompt(text: string, attachments: readonly string[]): string {
  return [...attachments, text].filter((part) => part !== '').join('\n');
}

/**
 * Inverse of composePrompt, for rendering. Pulls every clip path out wherever it
 * sits — own line, leading, trailing or mid-line — because `ccd clip` types the
 * path with no Enter, so the user's prose lands on either side of it. Paths come
 * back in document order and deduplicated; the prose has the holes closed up.
 */
export function splitClipPaths(text: string): { paths: string[]; rest: string } {
  const paths: string[] = [];
  const rest = text.replace(new RegExp(CLIP_PATH_RE.source, 'g'), (match) => {
    if (!paths.includes(match)) paths.push(match);
    return '';
  });
  return {
    paths,
    rest: rest.replace(/[^\S\n]+/g, ' ').replace(/ ?\n ?/g, '\n').trim(),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd infra/ccrc/pwa && npx vitest run test/compose.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Confirm nothing else broke**

Run: `cd infra/ccrc/pwa && npx vitest run` → 179 passed (169 + 10).
Run: `cd infra/ccrc/server && npx vitest run` → 173 passed.

- [ ] **Step 6: Commit**

```bash
git add infra/ccrc/shared/api.ts infra/ccrc/pwa/test/compose.test.ts
git commit -m "feat(ccrc): shared prompt composition for image attachments"
```

---

## Task 2: Server — stage an upload instead of typing it

**Files:**
- Modify: `infra/ccrc/server/src/clip.ts` (replace `saveUploadAndClip` entirely)
- Test: `infra/ccrc/server/test/clip.test.ts` (rewrite)

**Interfaces:**
- Consumes: `StagedClip` (Task 1).
- Produces: `clipName(ext: string, now: number, rand: string): string`; `clipPath(clipsDir: string, id: string, name: string): string` (throws `Error('bad-session-id')`); `stageUpload(io: FleetIO, cfg: CcrcConfig, id: string, data: Buffer, ext: string, now?: number, rand?: string): Promise<StagedClip>`.

- [ ] **Step 1: Write the failing test**

Replace `infra/ccrc/server/test/clip.test.ts`:

```ts
// Staging, not clipping: the upload lands in ~/.cc-clips/<id>/ and its path is
// RETURNED. Nothing is typed into the session — that happens once, at send.
import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { localIO } from '../src/io.js';
import { clipName, clipPath, stageUpload } from '../src/clip.js';

const ID = 'claude2-MekWarLive';
const cfgFor = () => loadConfig({ CCRC_HOME: mkdtempSync(path.join(tmpdir(), 'ccrc-')) });

describe('clipName', () => {
  it('keeps the real extension — a JPEG must not be named .png', () => {
    expect(clipName('jpg', Date.parse('2026-07-26T15:03:40Z'), 'a1b2'))
      .toMatch(/^clip-\d{8}-\d{6}-a1b2\.jpg$/);
  });

  it('separates two clips filed in the same second', () => {
    const t = Date.parse('2026-07-26T15:03:40Z');
    expect(clipName('png', t, 'a1b2')).not.toBe(clipName('png', t, 'c3d4'));
  });
});

describe('clipPath', () => {
  it('refuses a session id that would escape the clips dir', () => {
    expect(() => clipPath('/home/u/.cc-clips', '../../.ssh', 'clip-x.png')).toThrow('bad-session-id');
    expect(() => clipPath('/home/u/.cc-clips', '..', 'clip-x.png')).toThrow('bad-session-id');
    expect(() => clipPath('/home/u/.cc-clips', 'a/b', 'clip-x.png')).toThrow('bad-session-id');
  });

  it('builds the path for a well-formed id', () => {
    expect(clipPath('/home/u/.cc-clips', ID, 'clip-x.png'))
      .toBe(`/home/u/.cc-clips/${ID}/clip-x.png`);
  });
});

describe('stageUpload', () => {
  it('writes the bytes under the session and returns where they went', async () => {
    const cfg = cfgFor();
    const data = Buffer.from('screenshot-bytes');
    const clip = await stageUpload(localIO, cfg, ID, data, 'png',
      Date.parse('2026-07-26T15:03:40Z'), 'a1b2');

    expect(clip.path).toBe(path.join(cfg.clipsDir, ID, clip.name));
    expect(clip.name).toMatch(/^clip-\d{8}-\d{6}-a1b2\.png$/);
    expect(clip.bytes).toBe(data.byteLength);
    expect(readFileSync(clip.path)).toEqual(data);
  });

  it('throws rather than writing outside the clips dir', async () => {
    const cfg = cfgFor();
    await expect(stageUpload(localIO, cfg, '../../.ssh', Buffer.from('x'), 'png'))
      .rejects.toThrow('bad-session-id');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd infra/ccrc/server && npx vitest run test/clip.test.ts`
Expected: FAIL — `clipName` / `clipPath` / `stageUpload` are not exported.

- [ ] **Step 3: Write minimal implementation**

Replace the body of `infra/ccrc/server/src/clip.ts`:

```ts
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import type { StagedClip } from '../../shared/api.js';
import type { CcrcConfig } from './config.js';
import type { FleetIO } from './io.js';

/** `clip-<YYYYmmdd-HHMMSS>-<rand8>.<ext>`. The random suffix is not decoration:
 *  the old one-second stamp let two clips filed in the same second overwrite
 *  each other. The extension is the REAL one — `ccd clip` called everything
 *  .png, so a downscaled JPEG lied about its format. */
export function clipName(ext: string, now: number, rand: string): string {
  const d = new Date(now);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  const stamp =
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  return `clip-${stamp}-${rand}.${ext}`;
}

/**
 * Where a clip goes, with containment asserted HERE rather than only in the
 * route. `id` arrives from a URL param, Fastify percent-decodes it, and in local
 * mode `writeFileB64` is an unguarded `mkdir -p` + write — so an id of
 * `../../.ssh` would write wherever it liked. Asserting at the write site
 * protects every future caller, not one handler.
 */
export function clipPath(clipsDir: string, id: string, name: string): string {
  const root = path.resolve(clipsDir);
  const full = path.resolve(root, id, name);
  if (!full.startsWith(root + path.sep)) throw new Error('bad-session-id');
  if (path.dirname(full) !== path.join(root, id)) throw new Error('bad-session-id');
  return full;
}

/** Save the upload into the session's clips dir and report its path. Nothing is
 *  typed into the session — the path enters the prompt once, at send. */
export async function stageUpload(
  io: FleetIO,
  cfg: CcrcConfig,
  id: string,
  data: Buffer,
  ext: string,
  now: number = Date.now(),
  rand: string = randomBytes(2).toString('hex'),
): Promise<StagedClip> {
  const name = clipName(ext, now, rand);
  const full = clipPath(cfg.clipsDir, id, name);
  await io.writeFileB64(full, data.toString('base64'));
  return { path: full, name, bytes: data.byteLength };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd infra/ccrc/server && npx vitest run test/clip.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Fix the now-broken caller**

`server.ts` still imports `saveUploadAndClip`. Run `cd infra/ccrc/server && npx tsc --noEmit`; expect an error at the upload route. Leave the route otherwise alone for now — just swap the call so the build is green:

```ts
const clip = await stageUpload(deps.io, deps.cfg, id, data, m[1]!.toLowerCase());
return { ok: true, clip };
```

and update the import. Re-run `npx tsc --noEmit` → clean.

- [ ] **Step 6: Run the suite**

Run: `cd infra/ccrc/server && npx vitest run`
Expected: PASS. `routes.test.ts`'s existing upload case asserts on the old
`{ok:true}`-only body; it still passes because the response is a superset. If it
asserts the absence of other keys, relax that one assertion to `body.ok === true`
and leave the rest — Task 3 replaces this case with the full contract.

- [ ] **Step 7: Commit**

```bash
git add infra/ccrc/server/src/clip.ts infra/ccrc/server/src/server.ts infra/ccrc/server/test/clip.test.ts
git commit -m "feat(ccrc): stage uploads into the clips dir instead of typing them"
```

---

## Task 3: Server — guard the session id on the write routes

**Files:**
- Modify: `infra/ccrc/server/src/server.ts` (upload route, ~`:286-298`)
- Test: `infra/ccrc/server/test/routes.test.ts`

**Interfaces:**
- Consumes: `stageUpload` (Task 2).
- Produces: `isSafeSessionId(id: string): boolean` (module-local); upload responds `{ ok: true, clip: StagedClip }`.

**Why this is a real hole, not hygiene:** `/upload` is the only session write route with no `knownId` guard (compare `:214`, `:225`, `:236`, `:242`). Until Task 2 that was harmless — `id` was only argv to `ccd clip`, which dies at `_alive`. Now `id` is a path component of a write, `localIO.writeFileB64` is an unguarded `mkdir -p` (`io.ts:67-70`), the agent's write whitelist only applies in `remote` mode, and multipart is a CORS-simple request with no CSRF check.

- [ ] **Step 1: Write the failing test**

Add to `infra/ccrc/server/test/routes.test.ts`:

```ts
describe('upload route id handling', () => {
  const png = (name = 'shot.png') => {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(8)], { type: 'image/png' }), name);
    return form;
  };

  it('stages a picked image and returns where it landed', async () => {
    const { app } = await makeApp([null]);
    const res = await app.inject({
      method: 'POST', url: `/api/sessions/${ID}/upload`, payload: png(),
    });
    expect(res.statusCode).toBe(200);
    const clip = res.json().clip as { path: string; name: string; bytes: number };
    expect(clip.name).toMatch(/^clip-\d{8}-\d{6}-[0-9a-f]{4}\.png$/);
    expect(clip.path).toContain(`/.cc-clips/${ID}/`);
  });

  it('refuses a traversing session id before touching the filesystem', async () => {
    const { app } = await makeApp([null]);
    for (const bad of ['..%2F..%2F.ssh', '%2Fetc', '..']) {
      const res = await app.inject({
        method: 'POST', url: `/api/sessions/${bad}/upload`, payload: png(),
      });
      expect([400, 404]).toContain(res.statusCode);
      expect(res.json().ok).toBe(false);
    }
  });

  it('404s an unknown but well-formed session', async () => {
    const { app } = await makeApp([null]);
    const res = await app.inject({
      method: 'POST', url: '/api/sessions/claude2-NoSuchProject/upload', payload: png(),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('unknown-session');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd infra/ccrc/server && npx vitest run test/routes.test.ts -t "upload route id handling"`
Expected: FAIL — the traversal and unknown-session cases return 200.

- [ ] **Step 3: Write minimal implementation**

Add beside `knownId` in `server.ts`:

```ts
  /** A session id safe to use as a single path component. NOT redundant with
   *  `knownId`: registry ids are derived from `<id>.uuid` filenames, so a file
   *  called `...uuid` yields the id `..`, which `knownId` would happily accept. */
  const isSafeSessionId = (id: string): boolean =>
    id.length > 0 && id !== '.' && id !== '..'
    && !id.includes('/') && !id.includes('\\') && !id.includes('\0');
```

Replace the upload route:

```ts
  // Image upload: stage the bytes under ~/.cc-clips/<id>/ and return the path.
  // Nothing is typed into the session — the prompt route injects it at send.
  app.post('/api/sessions/:id/upload', async (req, reply) => {
    const { id } = req.params as { id: string };
    // Both gates run BEFORE req.file(). Replying without consuming the multipart
    // body can cost the client the JSON response, so drain first — same reason
    // the 415 path below calls part.file.resume().
    if (!isSafeSessionId(id)) {
      req.raw.resume();
      return reply.code(400).send({ ok: false, error: 'bad-session-id' });
    }
    if (!(await knownId(id))) {
      req.raw.resume();
      return reply.code(404).send({ ok: false, error: 'unknown-session' });
    }
    const part = await req.file();
    if (!part) return reply.code(400).send({ ok: false, error: 'bad-request' });
    const m = /\.(png|jpe?g|webp)$/i.exec(part.filename ?? '');
    if (!m) {
      part.file.resume();
      return reply.code(415).send({ ok: false, error: 'unsupported-type' });
    }
    const data = await part.toBuffer();
    if (data.byteLength > MAX_UPLOAD_BYTES) {
      return reply.code(413).send({ ok: false, error: 'too-large' });
    }
    const clip = await stageUpload(deps.io, deps.cfg, id, data, m[1]!.toLowerCase());
    return { ok: true, clip };
  });
```

Add near the other module constants at the top of `server.ts`:

```ts
/** Post-downscale ceiling for one attachment. */
const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd infra/ccrc/server && npx vitest run test/routes.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add infra/ccrc/server/src/server.ts infra/ccrc/server/test/routes.test.ts
git commit -m "fix(ccrc): gate the upload route's session id before it becomes a path"
```

---

## Task 4: Server — inject attachments with the prompt

**Files:**
- Modify: `infra/ccrc/server/src/inject/send.ts`, `infra/ccrc/server/src/server.ts` (prompt route)
- Test: `infra/ccrc/server/test/send.test.ts`, `infra/ccrc/server/test/routes.test.ts`

**Interfaces:**
- Consumes: `composePrompt`, `CLIP_PATH_RE` (Task 1); `clipPath` (Task 2); `isSafeSessionId` (Task 3).
- Produces: `sendPrompt(d, id, text, opts?: { replaceDraft?: boolean; attachments?: string[] })`; prompt route accepts `attachments?: string[]`, rejects with `400 bad-attachment`.

**The echo check is the subtle part.** Keep the needle as the first 24 chars of the composed prompt's first non-blank line — a logical line starts at column 2, so its first 24 chars cannot be split by wrapping, which is exactly the invariant `send.ts:120-121` documents. Do **not** switch to the path's tail; that is the part wrapping splits. Instead fix the *comparison*: match against the input box row, not the whole pane. Every clip path shares the prefix `/home/you/.cc-cli`, but the box was verified empty moments earlier, so that prefix on the box row can only be the path just typed — whereas a whole-pane `includes` would match an identical path sitting in scrollback and pass a send that never echoed.

- [ ] **Step 1: Write the failing test**

Add to `infra/ccrc/server/test/send.test.ts` (reuse the file's existing tmux/queue harness):

```ts
describe('sendPrompt with attachments', () => {
  const P = '/home/u/.cc-clips/claude2-Proj/clip-20260726-150340-a1b2.png';

  it('types the paths above the text as one turn', async () => {
    const { deps, sent } = harness({ box: `❯ ${P}`, submitted: true });
    const r = await sendPrompt(deps, ID, 'what is this', { attachments: [P] });
    expect(r.ok).toBe(true);
    // Alt+Enter separates the lines; the path goes first.
    expect(sent.literal).toEqual([P, 'what is this']);
    expect(sent.keys).toContain('M-Enter');
  });

  it('verifies the echo against the input box, not the scrollback', async () => {
    // The identical path sits in scrollback from an earlier turn, but the box is
    // empty — the send never echoed and must NOT be reported ok.
    const { deps } = harness({
      pane: `some earlier turn ${P}\n\n❯ `,
      box: '❯ ',
      submitted: false,
    });
    const r = await sendPrompt(deps, ID, '', { attachments: [P] });
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error).toBe('verify-failed');
  });

  it('clears the box when a send with attachments fails to verify', async () => {
    const { deps, sent } = harness({ box: '❯ ', submitted: false });
    await sendPrompt(deps, ID, 'x', { attachments: [P] });
    // Otherwise the paths are stranded in the live box — the exact state this
    // whole design exists to remove.
    expect(sent.keys).toContain('C-u');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd infra/ccrc/server && npx vitest run test/send.test.ts -t "with attachments"`
Expected: FAIL — `sendPrompt` has no `attachments` option.

- [ ] **Step 3: Write minimal implementation**

In `inject/send.ts`, import `composePrompt` and change the signature:

```ts
export function sendPrompt(
  d: SendDeps,
  id: string,
  text: string,
  opts: { replaceDraft?: boolean; attachments?: readonly string[] } = {},
): Promise<SendResult> {
```

Replace the line that splits the text with:

```ts
    const attachments = opts.attachments ?? [];
    const composed = composePrompt(text, attachments);
    const parts = composed.split('\n');
```

Replace the echo-verification block:

```ts
    // Prove the echo against the INPUT BOX, not the whole pane. Attachment
    // prompts all begin with the same ~24 chars of clips path, so a whole-pane
    // `includes` would happily match an identical path left in the scrollback by
    // an earlier turn. The box was verified empty a few lines up, so a needle on
    // the box row can only be what we just typed.
    const needle = parts.find((p) => p.trim().length > 0)?.slice(0, ECHO_NEEDLE) ?? '';
    const squash = (s: string): string => s.replace(/\s+/g, '');
    let after: string | null = null;
    let echoed = needle === '';
    for (let i = 0; i < ECHO_TRIES && !echoed; i++) {
      await sleep(ECHO_POLL_MS);
      const ansi = await d.tmux.captureAnsi(id);
      if (ansi === null) continue;
      after = await d.tmux.capture(id);
      if (draftOf(ansi).startsWith(needle)) { echoed = true; break; }
      // Fallback ONLY when the pane has no input-box row to read at all (a very
      // narrow or mid-render pane): whitespace-blind whole-pane match, so a row
      // break alone cannot fail an honest send. When a box row IS present it is
      // authoritative — falling back here is what would let a scrollback hit
      // pass a send that never echoed.
      if (!/❯/.test(ansi) && after !== null && squash(after).includes(squash(needle))) {
        echoed = true;
        break;
      }
    }
    if (!echoed) {
      if (attachments.length > 0) await d.tmux.sendKey(id, 'C-u');
      return { ok: false, error: 'verify-failed', pane: (after ?? '').slice(-PANE_TAIL) };
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd infra/ccrc/server && npx vitest run test/send.test.ts`
Expected: PASS — including the pre-existing echo tests.

- [ ] **Step 5: Accept attachments on the prompt route**

In `server.ts`, inside the prompt route after the `text` check:

```ts
    const raw = Array.isArray(body.attachments) ? body.attachments : [];
    if (raw.length > MAX_ATTACHMENTS) {
      return reply.code(400).send({ ok: false, error: 'bad-attachment' });
    }
    const attachments: string[] = [];
    for (const a of raw) {
      if (typeof a !== 'string') return reply.code(400).send({ ok: false, error: 'bad-attachment' });
      const name = a.slice(a.lastIndexOf('/') + 1);
      if (!CLIP_NAME_RE.test(name)) {
        return reply.code(400).send({ ok: false, error: 'bad-attachment' });
      }
      let resolved: string;
      try {
        resolved = clipPath(deps.cfg.clipsDir, id, name);
      } catch {
        return reply.code(400).send({ ok: false, error: 'bad-attachment' });
      }
      // The client must name the file that staging returned, in THIS session.
      if (resolved !== a) return reply.code(400).send({ ok: false, error: 'bad-attachment' });
      attachments.push(resolved);
    }
```

and pass `{ replaceDraft, attachments }` into `sendPrompt`. Add the constants:

```ts
const MAX_ATTACHMENTS = 4;
/** One clip filename — no slash, no dots to climb with. */
const CLIP_NAME_RE = /^clip-[A-Za-z0-9._-]+\.(?:png|jpe?g|webp)$/;
```

Also relax the `text` guard so an image-only prompt is legal: require
`typeof body.text === 'string'` and `body.text.length > 0 || attachments.length > 0`.

- [ ] **Step 6: Test the route**

Add to `routes.test.ts`:

```ts
it('rejects an attachment outside this session’s clips dir', async () => {
  const { app } = await makeApp([EMPTY_BOX]);
  for (const bad of [
    '/etc/passwd',
    '/home/u/.cc-clips/other-session/clip-20260726-150340-a1b2.png',
    '/home/u/.cc-clips/claude2-MekWarLive/../../x/clip-20260726-150340-a1b2.png',
  ]) {
    const res = await app.inject({
      method: 'POST', url: `/api/sessions/${ID}/prompt`,
      payload: { text: 'hi', attachments: [bad] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('bad-attachment');
  }
});

it('rejects a fifth attachment', async () => {
  const { app } = await makeApp([EMPTY_BOX]);
  const many = Array.from({ length: 5 }, (_, i) =>
    `${homeOf(app)}/.cc-clips/${ID}/clip-20260726-15034${i}-a1b2.png`);
  const res = await app.inject({
    method: 'POST', url: `/api/sessions/${ID}/prompt`, payload: { text: 'hi', attachments: many },
  });
  expect(res.statusCode).toBe(400);
});
```

(`EMPTY_BOX` and `homeOf` follow the file's existing helpers; if `homeOf` does not
exist, have `makeApp` return the `home` it created and use that.)

Run: `cd infra/ccrc/server && npx vitest run` → all pass.

- [ ] **Step 7: Commit**

```bash
git add infra/ccrc/server/src/inject/send.ts infra/ccrc/server/src/server.ts \
        infra/ccrc/server/test/send.test.ts infra/ccrc/server/test/routes.test.ts
git commit -m "feat(ccrc): inject staged attachments with the prompt, atomically"
```

---

## Task 5: Binary reads through the fs facade

**Files:**
- Modify: `infra/ccrc/server/src/io.ts`, `infra/ccrc/server/src/remote/io.ts`, `infra/ccrc/shared/agent-protocol.ts`, `infra/ccrc/agent/src/fileops.ts`, `infra/ccrc/agent/src/server.ts`
- Test: `infra/ccrc/server/test/io.test.ts`, `infra/ccrc/server/test/remote-io.test.ts`, `infra/ccrc/agent/test/fileops.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `FleetIO.readFileB64(path: string): Promise<string | null>`; agent op `{ t: 'req', op: 'readB64', path }` → `{ dataB64: string | null }`.

The clip route must work in remote-fleet mode, so the read goes through the facade
like every other fleet-fs access. `.cc-clips/` is already read-whitelisted
(`agent/src/whitelist.ts:86`) — no policy change.

- [ ] **Step 1: Write the failing tests**

`server/test/io.test.ts`:

```ts
it('reads a binary file back as base64, and null when missing', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ccrc-io-'));
  const file = path.join(dir, 'clip.png');
  const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]);
  writeFileSync(file, bytes);
  expect(await localIO.readFileB64(file)).toBe(bytes.toString('base64'));
  expect(await localIO.readFileB64(path.join(dir, 'nope.png'))).toBeNull();
});
```

`agent/test/fileops.test.ts`:

```ts
it('serves readB64 for a whitelisted clip, and refuses outside the root', async () => {
  const bytes = Buffer.from([0x00, 0x01, 0xfe]);
  writeFileSync(path.join(clipsDir, 'clip-x.png'), bytes);
  await expect(request({ op: 'readB64', path: path.join(clipsDir, 'clip-x.png') }))
    .resolves.toMatchObject({ dataB64: bytes.toString('base64') });
  await expect(request({ op: 'readB64', path: '/etc/passwd' })).rejects.toThrow(/forbidden/);
});
```

(Both files already have the fixtures/helpers these use — follow the surrounding style.)

- [ ] **Step 2: Run to verify they fail**

Run: `cd infra/ccrc/server && npx vitest run test/io.test.ts` → FAIL, `readFileB64 is not a function`.
Run: `cd infra/ccrc/agent && npx vitest run test/fileops.test.ts` → FAIL, unknown op.

- [ ] **Step 3: Implement**

`shared/agent-protocol.ts` — add and union in:

```ts
export interface ReadB64Req { t: 'req'; id: number; op: 'readB64'; path: string }
```
(add `ReadB64Req` to `AgentReq`, and note in the response comment: `readB64 → {dataB64: string|null}`)

`server/src/io.ts` — extend the interface and `localIO`:

```ts
  readFileB64(path: string): Promise<string | null>;      // null = missing; binary-safe
```
```ts
  async readFileB64(p) {
    try { return (await readFile(p)).toString('base64'); } catch { return null; }
  },
```

`server/src/remote/io.ts`:

```ts
    async readFileB64(path) {
      try {
        const res = await client.request({ t: 'req', op: 'readB64', path });
        const data = (res as { dataB64?: unknown }).dataB64;
        return typeof data === 'string' ? data : null;
      } catch {
        return null;
      }
    },
```

`agent/src/fileops.ts` + `agent/src/server.ts` — mirror the existing `read` case,
reading with no encoding and replying `{ dataB64 }`; reject over 12 MB.

- [ ] **Step 4: Run to verify they pass**

Run: `cd infra/ccrc/server && npx vitest run` → all pass.
Run: `cd infra/ccrc/agent && npx vitest run` → all pass (82 + 1).

- [ ] **Step 5: Commit**

```bash
git add infra/ccrc/shared/agent-protocol.ts infra/ccrc/server/src/io.ts \
        infra/ccrc/server/src/remote/io.ts infra/ccrc/agent/src \
        infra/ccrc/server/test/io.test.ts infra/ccrc/server/test/remote-io.test.ts \
        infra/ccrc/agent/test/fileops.test.ts
git commit -m "feat(ccrc): binary reads through the fs facade (readB64)"
```

---

## Task 6: Server — serve a clip back

**Files:**
- Modify: `infra/ccrc/server/src/server.ts`
- Test: `infra/ccrc/server/test/routes.test.ts`

**Interfaces:**
- Consumes: `isSafeSessionId` (Task 3), `clipPath` (Task 2), `readFileB64` (Task 5), `CLIP_NAME_RE` (Task 4).
- Produces: `GET /api/sessions/:id/clip/:name` → image bytes.

- [ ] **Step 1: Write the failing test**

```ts
describe('clip route', () => {
  it('serves a staged clip with an immutable cache header', async () => {
    const { app } = await makeApp([null]);
    const up = await app.inject({
      method: 'POST', url: `/api/sessions/${ID}/upload`, payload: pngForm(),
    });
    const { name } = up.json().clip as { name: string };
    const res = await app.inject({ method: 'GET', url: `/api/sessions/${ID}/clip/${name}` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['cache-control']).toContain('immutable');
  });

  it('refuses a name that is not a clip, and a traversing one', async () => {
    const { app } = await makeApp([null]);
    for (const bad of ['..%2F..%2F.ssh%2Fid_rsa', 'notaclip.png', 'clip-x.exe']) {
      const res = await app.inject({ method: 'GET', url: `/api/sessions/${ID}/clip/${bad}` });
      expect(res.statusCode).toBe(400);
    }
  });

  it('404s a clip that is not on disk', async () => {
    const { app } = await makeApp([null]);
    const res = await app.inject({
      method: 'GET', url: `/api/sessions/${ID}/clip/clip-20260726-150340-a1b2.png`,
    });
    expect(res.statusCode).toBe(404);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd infra/ccrc/server && npx vitest run test/routes.test.ts -t "clip route"`
Expected: FAIL — 404 from the SPA fallback for every case.

- [ ] **Step 3: Implement**

```ts
const CLIP_MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
};

  // Thumbnails for sent messages. Names are unique, so the bytes behind one can
  // never change — hence `immutable`.
  app.get('/api/sessions/:id/clip/:name', async (req, reply) => {
    const { id, name } = req.params as { id: string; name: string };
    if (!isSafeSessionId(id) || !CLIP_NAME_RE.test(name)) {
      return reply.code(400).send({ ok: false, error: 'bad-request' });
    }
    // `ccd stop` leaves the registry entry, so a stopped session's thumbnails
    // still resolve.
    if (!(await knownId(id))) return reply.code(404).send({ ok: false, error: 'unknown-session' });
    let file: string;
    try {
      file = clipPath(deps.cfg.clipsDir, id, name);
    } catch {
      return reply.code(400).send({ ok: false, error: 'bad-request' });
    }
    const b64 = await deps.io.readFileB64(file);
    if (b64 === null) return reply.code(404).send({ ok: false, error: 'not-found' });
    const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
    return reply
      .type(CLIP_MIME[ext] ?? 'application/octet-stream')
      .header('cache-control', 'private, max-age=31536000, immutable')
      .send(Buffer.from(b64, 'base64'));
  });
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd infra/ccrc/server && npx vitest run` → all pass.

- [ ] **Step 5: Commit**

```bash
git add infra/ccrc/server/src/server.ts infra/ccrc/server/test/routes.test.ts
git commit -m "feat(ccrc): serve staged clips back for transcript thumbnails"
```

---

## Task 7: `ccd clip` — honest names for the terminal hotkey

**Files:**
- Modify: `infra/<server-host>-portability/ccd` (`cmd_clip`, ~`:586-602`)
- Test: `infra/ccrc/server/test/ccd-clip.test.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: shell function `_clip_dest <dir> <src>` echoing the destination path.

`cmd_clip` `die`s at `_alive "$id"` long before it computes `dest`, so the naming
cannot be asserted by calling `cmd_clip`. Extract it.

- [ ] **Step 1: Write the failing test**

```ts
// The Mac hotkey lane. `ccd clip` still types the path — correct for a terminal —
// but it used to name every destination .png regardless of the real format, and
// its one-second stamp let two clips in the same second overwrite each other.
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const CCD = path.resolve(__dirname, '../../../<server-host>-portability/ccd');
const dest = (src: string): string =>
  execFileSync('bash', ['-c', `source "${CCD}"; _clip_dest /tmp/clips "${src}"`],
    { encoding: 'utf8' }).trim();

describe('_clip_dest', () => {
  it('keeps the source extension instead of calling everything .png', () => {
    expect(dest('/tmp/photo.jpg')).toMatch(/\.jpg$/);
    expect(dest('/tmp/shot.PNG')).toMatch(/\.png$/);
  });

  it('does not collide for two clips filed in the same second', () => {
    expect(dest('/tmp/a.png')).not.toBe(dest('/tmp/a.png'));
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd infra/ccrc/server && npx vitest run test/ccd-clip.test.ts`
Expected: FAIL — `_clip_dest: command not found`.

- [ ] **Step 3: Implement**

In `ccd`, above `cmd_clip`:

```bash
# <dir> <src> — destination for a filed clip. Split out of cmd_clip so it can be
# sourced and asserted: cmd_clip dies at `_alive` long before it gets here.
# Keeps the SOURCE extension (this used to hardcode .png, so a JPEG lied about
# its format) and adds a random suffix (the 1s stamp let two clips in the same
# second mv -f over each other).
_clip_dest() {
  local dir="$1" src="$2" ext
  ext="${src##*.}"
  ext="$(printf '%s' "$ext" | tr '[:upper:]' '[:lower:]')"
  case "$ext" in png|jpg|jpeg|webp) ;; *) ext=png ;; esac
  printf '%s/clip-%s-%04x.%s\n' "$dir" "$(date +%Y%m%d-%H%M%S)" "$((RANDOM % 65536))" "$ext"
}
```

and in `cmd_clip` replace the `dest` line with `local dest; dest="$(_clip_dest "$dir" "$png")"`.

- [ ] **Step 4: Run to verify it passes**

Run: `cd infra/ccrc/server && npx vitest run test/ccd-clip.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add infra/<server-host>-portability/ccd infra/ccrc/server/test/ccd-clip.test.ts
git commit -m "fix(ccd): clips keep their real extension and stop overwriting each other"
```

---

## Task 8: PWA — API client

**Files:**
- Modify: `infra/ccrc/pwa/src/lib/api.ts`
- Test: `infra/ccrc/pwa/test/api.test.ts`

**Interfaces:**
- Consumes: `StagedClip` (Task 1).
- Produces: `upload(id, file): Promise<StagedClip>`; `prompt(id, text, opts?: { replaceDraft?: boolean; attachments?: string[] })`; `clipUrl(id: string, name: string): string`.

`clipUrl` returns an **origin-qualified** URL. `openExternal` runs its href through
`absolute()` (`MessageBubble.tsx:34`), which turns a bare `/api/…` into
`https:///api/…` — an empty-host URL, i.e. a broken tap. One origin-qualified
definition serves both `MessageBubble` and `PendingBubble`, and sidesteps
`openExternal` being module-private.

- [ ] **Step 1: Write the failing test**

```ts
describe('attachments', () => {
  it('returns where an upload landed', async () => {
    const clip = { path: '/home/u/.cc-clips/s/clip-1-a1b2.png', name: 'clip-1-a1b2.png', bytes: 9 };
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, clip }), { status: 200 }));
    const api = createApi(fetchImpl as unknown as typeof fetch);
    await expect(api.upload('s', new File(['x'], 'a.png', { type: 'image/png' }))).resolves.toEqual(clip);
  });

  it('posts attachments alongside the text', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    const api = createApi(fetchImpl as unknown as typeof fetch);
    await api.prompt('s', 'hi', { attachments: ['/home/u/.cc-clips/s/clip-1-a1b2.png'] });
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body as string)).toEqual({
      text: 'hi', attachments: ['/home/u/.cc-clips/s/clip-1-a1b2.png'],
    });
  });

  it('builds an origin-qualified clip URL — a bare path breaks openExternal', () => {
    expect(clipUrl('claude2-Proj', 'clip-1-a1b2.png'))
      .toBe(`${location.origin}/api/sessions/claude2-Proj/clip/clip-1-a1b2.png`);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd infra/ccrc/pwa && npx vitest run test/api.test.ts -t "attachments"` → FAIL.

- [ ] **Step 3: Implement**

```ts
    upload: async (id: string, file: File): Promise<StagedClip> => {
      const form = new FormData();
      form.append('file', file, file.name);
      const res = await request(`${sid(id)}/upload`, { method: 'POST', body: form });
      return ((await res.json()) as { clip: StagedClip }).clip;
    },
    prompt: (id: string, text: string, opts: { replaceDraft?: boolean; attachments?: string[] } = {}) =>
      post(`${sid(id)}/prompt`, {
        text,
        ...(opts.replaceDraft === undefined ? {} : { replaceDraft: opts.replaceDraft }),
        ...(opts.attachments?.length ? { attachments: opts.attachments } : {}),
      }),
```

and at module scope:

```ts
/** Origin-qualified on purpose: MessageBubble's `absolute()` turns a bare
 *  `/api/...` into `https:///api/...` (empty host), so a root-relative href
 *  would make every thumbnail tap dead. `/api/` is in navigateFallbackDenylist,
 *  so the SPA shell does not hijack it. */
export const clipUrl = (id: string, name: string): string =>
  new URL(`/api/sessions/${encodeURIComponent(id)}/clip/${encodeURIComponent(name)}`,
    location.origin).href;
```

Update the two existing `prompt` call sites (`stores/session.ts`) to the object form.

- [ ] **Step 4: Run to verify it passes**

Run: `cd infra/ccrc/pwa && npx vitest run` → all pass.

- [ ] **Step 5: Commit**

```bash
git add infra/ccrc/pwa/src/lib/api.ts infra/ccrc/pwa/src/stores/session.ts infra/ccrc/pwa/test/api.test.ts
git commit -m "feat(ccrc): api client for staged clips"
```

---

## Task 9: PWA — the staged-images hook

**Files:**
- Modify: `infra/ccrc/pwa/src/session/useAttachImage.ts`
- Create: `infra/ccrc/pwa/test/staged-images.test.tsx`
- Modify: `infra/ccrc/pwa/test/setup.ts`

**Interfaces:**
- Consumes: `api.upload` (Task 8).
- Produces:

```ts
export interface StagedImage {
  key: string;
  file: File;
  previewUrl: string;
  state: 'uploading' | 'staged' | 'failed';
  path?: string;
  width?: number;
  height?: number;
  error?: string;
}
export interface StagedImages {
  images: StagedImage[];
  add: (files: readonly File[]) => void;
  remove: (key: string) => void;
  retry: (key: string) => void;
  /** Empty the tray WITHOUT revoking — send hands the object URLs to the
   *  PendingSend, which shows them and revokes them when it resolves. */
  release: () => void;
  uploading: boolean;
  hasFailed: boolean;
}
export function useStagedImages(id: string, downscale?: (f: File) => Promise<Blob>): StagedImages;
export function clipboardImages(data: DataTransfer | null): File[];
export const MAX_IMAGES = 4;
```

**Measure dimensions on both branches.** `useAttachImage.ts:88` short-circuits for
small PNGs (`keepOriginal`) and never calls `downscale`, so no bitmap exists on
exactly the lossless-screenshot path this feature is proudest of. Run one
`createImageBitmap` on the **payload** (not the source file) in the hook rather
than widening `downscaleImage`'s return type — that function is re-exported
through `AttachButton.tsx:11` and widening it ripples for no gain.

- [ ] **Step 1: Stub the jsdom gaps**

Add to `infra/ccrc/pwa/test/setup.ts`:

```ts
// jsdom has neither object URLs nor an image decoder.
let objectUrlSeq = 0;
URL.createObjectURL = vi.fn(() => `blob:mock/${++objectUrlSeq}`);
URL.revokeObjectURL = vi.fn();
globalThis.createImageBitmap = vi.fn(async () =>
  ({ width: 2788, height: 442, close: () => {} }) as unknown as ImageBitmap);
```

- [ ] **Step 2: Write the failing test**

Create `infra/ccrc/pwa/test/staged-images.test.tsx`. These drive the **hook**, not
the composer — the tray markup lands in Task 10 and the wiring in Task 11, so this
task stays independently testable:

```tsx
// The staged-images hook on its own. A tiny harness stands in for the tray so
// this task does not depend on Task 10's markup or Task 11's composer wiring.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ToastHost } from '../src/components/Toast';
import { api, ApiError } from '../src/lib/api';
import { useStagedImages } from '../src/session/useAttachImage';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const ID = 'claude2-Proj';
const CLIP = { path: '/home/u/.cc-clips/claude2-Proj/clip-1-a1b2.png', name: 'clip-1-a1b2.png', bytes: 9 };
const shot = (name = 'shot.png') => new File(['tiny'], name, { type: 'image/png' });

/** Renders the hook's state as plain text, so assertions read the hook and not
 *  a component's styling choices. */
function Harness({ files }: { files: File[] }): React.ReactNode {
  const s = useStagedImages(ID);
  return (
    <div>
      <button type="button" onClick={() => s.add(files)}>add</button>
      <span data-testid="uploading">{String(s.uploading)}</span>
      <span data-testid="failed">{String(s.hasFailed)}</span>
      <ul>
        {s.images.map((i) => (
          <li key={i.key} data-testid={`img-${i.file.name}`}>
            <span data-testid={`state-${i.file.name}`}>{i.state}</span>
            <span data-testid={`dims-${i.file.name}`}>
              {i.width && i.height ? `${i.width}×${i.height}` : ''}
            </span>
            <span data-testid={`path-${i.file.name}`}>{i.path ?? ''}</span>
            <button type="button" onClick={() => s.remove(i.key)}>remove {i.file.name}</button>
            <button type="button" onClick={() => s.retry(i.key)}>retry {i.file.name}</button>
          </li>
        ))}
      </ul>
    </div>
  );
}

describe('useStagedImages', () => {
  it('stages an image and reports the payload’s dimensions', async () => {
    vi.spyOn(api, 'upload').mockResolvedValue(CLIP);
    render(<Harness files={[shot()]} />);
    fireEvent.click(screen.getByText('add'));

    await waitFor(() => expect(screen.getByTestId('state-shot.png')).toHaveTextContent('staged'));
    expect(screen.getByTestId('path-shot.png')).toHaveTextContent(CLIP.path);
    // The small-PNG passthrough skips the downscale entirely — the dimensions
    // must still be there. This is the branch a naive implementation misses.
    expect(screen.getByTestId('dims-shot.png')).toHaveTextContent('2788×442');
  });

  it('removes an image and revokes its object URL', async () => {
    vi.spyOn(api, 'upload').mockResolvedValue(CLIP);
    render(<Harness files={[shot()]} />);
    fireEvent.click(screen.getByText('add'));
    await waitFor(() => expect(screen.getByTestId('state-shot.png')).toHaveTextContent('staged'));

    fireEvent.click(screen.getByText('remove shot.png'));
    expect(screen.queryByTestId('img-shot.png')).not.toBeInTheDocument();
    expect(URL.revokeObjectURL).toHaveBeenCalled();
  });

  it('marks a failed upload and retries the same file', async () => {
    const upload = vi.spyOn(api, 'upload')
      .mockRejectedValueOnce(new ApiError(502, { error: 'nope' }))
      .mockResolvedValueOnce(CLIP);
    render(<Harness files={[shot()]} />);
    fireEvent.click(screen.getByText('add'));
    await waitFor(() => expect(screen.getByTestId('failed')).toHaveTextContent('true'));

    fireEvent.click(screen.getByText('retry shot.png'));
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByTestId('state-shot.png')).toHaveTextContent('staged'));
  });

  it('refuses a fifth image', async () => {
    vi.spyOn(api, 'upload').mockResolvedValue(CLIP);
    const five = Array.from({ length: 5 }, (_, i) => shot(`s${i}.png`));
    render(<><Harness files={five} /><ToastHost /></>);
    fireEvent.click(screen.getByText('add'));

    expect(await screen.findByText(/Four images per message/)).toBeInTheDocument();
    expect(screen.queryByTestId('img-s4.png')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd infra/ccrc/pwa && npx vitest run test/staged-images.test.tsx` → FAIL, `useStagedImages is not a function`.

- [ ] **Step 4: Implement the hook**

Keep `downscaleImage`, `namedClipboardImage`, `SMALL_PNG_MAX`, `EXT_FOR_TYPE` as
they are. Replace `clipboardImage` with the plural form, and replace
`useAttachImage` with `useStagedImages`:

```ts
/** Every image on the clipboard. Text pastes give []. */
export function clipboardImages(data: DataTransfer | null): File[] {
  return Array.from(data?.items ?? [])
    .filter((i) => i.kind === 'file' && i.type.startsWith('image/'))
    .map((i) => i.getAsFile())
    .filter((f): f is File => f !== null);
}

export const MAX_IMAGES = 4;

export function useStagedImages(
  id: string,
  downscale: (file: File) => Promise<Blob> = downscaleImage,
): StagedImages {
  const [images, setImages] = useState<StagedImage[]>([]);
  const seq = useRef(0);

  const patch = (key: string, next: Partial<StagedImage>): void =>
    setImages((cur) => cur.map((i) => (i.key === key ? { ...i, ...next } : i)));

  const upload = async (key: string, file: File): Promise<void> => {
    try {
      const keepOriginal = file.type === 'image/png' && file.size < SMALL_PNG_MAX;
      let payload = file;
      if (!keepOriginal) {
        const blob = await downscale(file);
        const ext = blob.type === 'image/png' ? 'png' : 'jpg';
        payload = new File([blob], `${file.name.replace(/\.[^.]*$/, '')}.${ext}`, { type: blob.type });
      }
      // Measure the PAYLOAD on both branches — the caption answers "did the
      // downscale ruin my screenshot", and keepOriginal never decodes otherwise.
      const bitmap = await createImageBitmap(payload);
      const width = bitmap.width;
      const height = bitmap.height;
      bitmap.close();
      const clip = await api.upload(id, payload);
      patch(key, { state: 'staged', path: clip.path, width, height, error: undefined });
    } catch (err) {
      patch(key, { state: 'failed', error: apiErrorText(err) });
    }
  };

  const add = (files: readonly File[]): void => {
    const accepted: StagedImage[] = [];
    setImages((cur) => {
      const room = MAX_IMAGES - cur.length;
      if (files.length > room) toast(`Four images per message — send these first`, 'error');
      for (const file of files.slice(0, Math.max(0, room))) {
        const named = namedClipboardImage(file, Date.now() + accepted.length);
        if (named === null) {
          toast(`Can't attach ${file.type || 'that'} — PNG, JPEG or WebP only`, 'error');
          continue;
        }
        seq.current += 1;
        accepted.push({
          key: `img${seq.current}`,
          file: named,
          previewUrl: URL.createObjectURL(named),
          state: 'uploading',
        });
      }
      return [...cur, ...accepted];
    });
    for (const img of accepted) void upload(img.key, img.file);
  };

  const remove = (key: string): void =>
    setImages((cur) => {
      const gone = cur.find((i) => i.key === key);
      if (gone) URL.revokeObjectURL(gone.previewUrl);
      return cur.filter((i) => i.key !== key);
    });

  const retry = (key: string): void => {
    const img = images.find((i) => i.key === key);
    if (!img || img.state !== 'failed') return;
    patch(key, { state: 'uploading', error: undefined });
    void upload(key, img.file);
  };

  // Deliberately does NOT revoke: at send the object URLs pass to the
  // PendingSend, which renders them in the optimistic bubble and revokes them
  // when it confirms or is discarded. Revoking here would blank that bubble.
  const release = (): void => setImages([]);

  return {
    images, add, remove, retry, release,
    uploading: images.some((i) => i.state === 'uploading'),
    hasFailed: images.some((i) => i.state === 'failed'),
  };
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd infra/ccrc/pwa && npx vitest run test/staged-images.test.tsx`
Expected: PASS, 4 tests. This task is independently testable **because its tests
drive the hook directly** through the `Harness` above — the tray markup arrives in
Task 10 and the composer wiring in Task 11, and neither is needed here. Do not
write Composer-level attachment tests in this task; they belong to Task 11.

`test/attach.test.tsx` still covers the old `AttachButton` flow and must keep
passing untouched until Task 11 rewrites it.

- [ ] **Step 6: Commit**

```bash
git add infra/ccrc/pwa/src/session/useAttachImage.ts infra/ccrc/pwa/test/setup.ts \
        infra/ccrc/pwa/test/staged-images.test.tsx
git commit -m "feat(ccrc): a staged-images hook the composer owns"
```

---

## Task 10: PWA — the tray

**Files:**
- Create: `infra/ccrc/pwa/src/session/AttachTray.tsx`
- Modify: `infra/ccrc/pwa/src/session/chat.css`
- Test: `infra/ccrc/pwa/test/attach-tray.test.tsx` (create)

Task 9's tests drive the hook, not this markup, so the tray needs its own. Keep
them presentational — the states, the labels, the alt text — and leave the wiring
to Task 11.

```tsx
const img = (over: Partial<StagedImage> = {}): StagedImage => ({
  key: 'k1', file: new File(['x'], 'shot.png', { type: 'image/png' }),
  previewUrl: 'blob:mock/1', state: 'staged', width: 2788, height: 442, ...over,
});

it('renders nothing when there is nothing attached', () => {
  const { container } = render(<AttachTray images={[]} onRemove={vi.fn()} onRetry={vi.fn()} />);
  expect(container).toBeEmptyDOMElement();
});

it('shows the thumbnail, its dimensions and a labelled remove control', () => {
  render(<AttachTray images={[img()]} onRemove={vi.fn()} onRetry={vi.fn()} />);
  expect(screen.getByAltText('shot.png')).toHaveAttribute('src', 'blob:mock/1');
  expect(screen.getByText('2788×442')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Remove shot.png' })).toBeInTheDocument();
});

it('says it is uploading, and offers retry once it has failed', () => {
  const onRetry = vi.fn();
  const { rerender } = render(
    <AttachTray images={[img({ state: 'uploading', width: undefined, height: undefined })]}
                onRemove={vi.fn()} onRetry={onRetry} />);
  expect(screen.getByText('uploading…')).toBeInTheDocument();

  rerender(<AttachTray images={[img({ state: 'failed' })]} onRemove={vi.fn()} onRetry={onRetry} />);
  fireEvent.click(screen.getByText('retry'));
  expect(onRetry).toHaveBeenCalledWith('k1');
});
```

**Interfaces:**
- Consumes: `StagedImage`, `StagedImages` (Task 9).
- Produces: `<AttachTray images onRemove onRetry />`.

- [ ] **Step 1: Write the component**

```tsx
// The attachment tray — chips above the input bar. This is the whole feedback
// surface for attaching: the old success toast is gone, because it landed on top
// of the very input it told you to type into.
import type { ReactNode } from 'react';
import type { StagedImage } from './useAttachImage';
import './chat.css';

export interface AttachTrayProps {
  images: StagedImage[];
  onRemove: (key: string) => void;
  onRetry: (key: string) => void;
}

export function AttachTray({ images, onRemove, onRetry }: AttachTrayProps): ReactNode {
  if (images.length === 0) return null;
  return (
    <ul className="attach-tray" aria-label="Attached images">
      {images.map((img) => (
        <li key={img.key} className="attach-chip" data-state={img.state}>
          {img.state === 'failed' ? (
            <button type="button" className="attach-chip-retry" onClick={() => onRetry(img.key)}>
              <img src={img.previewUrl} alt={img.file.name} className="attach-thumb" />
              <span className="attach-strip">retry</span>
            </button>
          ) : (
            <>
              <img src={img.previewUrl} alt={img.file.name} className="attach-thumb" />
              <span className="attach-strip">
                {img.state === 'uploading'
                  ? 'uploading…'
                  : img.width && img.height
                    ? `${img.width}×${img.height}`
                    : ''}
              </span>
            </>
          )}
          <button
            type="button"
            className="attach-remove"
            aria-label={`Remove ${img.file.name}`}
            onClick={() => onRemove(img.key)}
          >
            <span aria-hidden="true">×</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 2: Style it**

Append to `chat.css` — 72px chips on `--bg-well` so a transparent PNG reads as a
well, the existing `attach-spin` arc for progress, and the reduced-motion freeze
the codebase already uses (pin the arc; never zero the loop period):

```css
/* Attachment tray — the chips ARE the confirmation that an image is attached,
   which is why the old "Image attached…" toast is gone. */
.attach-tray {
  display: flex;
  gap: var(--sp-2);
  margin: 0 0 var(--sp-2);
  padding: 0;
  list-style: none;
  overflow-x: auto;
  scroll-snap-type: x proximity;
}
.attach-chip {
  position: relative;
  flex: none;
  width: 72px;
  height: 72px;
  border-radius: var(--r-md);
  border: 1px solid var(--edge-subtle);
  background: var(--bg-well);
  overflow: hidden;
  scroll-snap-align: start;
}
.attach-chip[data-state='failed'] { border-color: var(--status-dead); }
.attach-chip-retry { all: unset; display: block; width: 100%; height: 100%; cursor: pointer; }
.attach-thumb { width: 100%; height: 100%; object-fit: cover; display: block; }
.attach-chip[data-state='uploading'] .attach-thumb { opacity: 0.55; }
.attach-chip[data-state='uploading']::before {
  content: '';
  position: absolute;
  inset: 24px;
  border-radius: var(--r-full);
  border: 2px solid var(--accent-tint);
  border-top-color: var(--accent);
  animation: attach-spin var(--caret-period) linear infinite;
  z-index: 1;
}
.attach-strip {
  position: absolute;
  inset: auto 0 0 0;
  padding: 2px 4px;
  background: linear-gradient(transparent, rgba(4, 6, 5, 0.72));
  color: var(--ink-on-well);
  font: var(--weight-regular) var(--text-2xs) / 1.2 var(--font-mono);
  font-variant-numeric: tabular-nums;
  text-align: center;
}
.attach-remove {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 20px;
  height: 20px;
  display: grid;
  place-items: center;
  border-radius: var(--r-full);
  border: 1px solid var(--edge-strong);
  background: var(--bg-sheet);
  color: var(--ink-primary);
  font: var(--weight-medium) var(--text-xs) / 1 var(--font-mono);
  cursor: pointer;
  z-index: 2;
}
/* 44px hit area without a 44px box — the .toast-action trick. */
.attach-remove::after { content: ''; position: absolute; inset: -12px; }

/* Desktop drop target. */
.composer[data-drop='true'] .inputbar {
  border-color: var(--accent);
  border-style: dashed;
  background: var(--accent-tint);
}

@media (prefers-reduced-motion: reduce) {
  .attach-chip[data-state='uploading']::before {
    animation: none;
    border-top-color: var(--accent-tint);
  }
}
```

- [ ] **Step 3: Run the tray tests**

Run: `cd infra/ccrc/pwa && npx vitest run test/attach-tray.test.tsx`
Expected: PASS, 3 tests.

- [ ] **Step 4: Verify the contrast gate**

Run: `cd infra/ccrc/pwa && node design/contrast-check.mjs`
Expected: `ALL 74 PASS` (no new token pairings were introduced — `--ink-on-well`
on a well is already covered).

- [ ] **Step 5: Commit**

```bash
git add infra/ccrc/pwa/src/session/AttachTray.tsx infra/ccrc/pwa/src/session/chat.css \
        infra/ccrc/pwa/test/attach-tray.test.tsx
git commit -m "feat(ccrc): attachment chips above the composer"
```

---

## Task 11: PWA — wire the composer

**Files:**
- Modify: `infra/ccrc/pwa/src/session/Composer.tsx`, `infra/ccrc/pwa/src/session/AttachButton.tsx`
- Test: `infra/ccrc/pwa/test/attach.test.tsx`, `infra/ccrc/pwa/test/paste.test.tsx`

**Interfaces:**
- Consumes: `useStagedImages` (Task 9), `AttachTray` (Task 10).
- Produces: `ComposerProps.onSend(text: string, opts?: { replaceDraft?: boolean; attachments?: string[] })`.

- [ ] **Step 1: Write the failing test**

```ts
it('sends the staged paths with the text and clears the tray', async () => {
  vi.spyOn(api, 'upload').mockResolvedValue(
    { path: '/p/clip-1-a1b2.png', name: 'clip-1-a1b2.png', bytes: 9 });
  const onSend = vi.fn();
  render(<Composer onSend={onSend} pending={[]} id={ID} />);
  pick(new File(['tiny'], 'shot.png', { type: 'image/png' }));
  await screen.findByAltText('shot.png');

  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'what is this' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));

  expect(onSend).toHaveBeenCalledWith('what is this', {
    attachments: [{ path: '/p/clip-1-a1b2.png', previewUrl: expect.stringMatching(/^blob:/) }],
  });
  // Released, not revoked — the pending bubble still needs that URL.
  expect(URL.revokeObjectURL).not.toHaveBeenCalled();
});

it('allows an image with no text — that is a legitimate prompt', async () => {
  vi.spyOn(api, 'upload').mockResolvedValue(
    { path: '/p/clip-1-a1b2.png', name: 'clip-1-a1b2.png', bytes: 9 });
  render(<Composer onSend={vi.fn()} pending={[]} id={ID} />);
  pick(new File(['tiny'], 'shot.png', { type: 'image/png' }));
  await screen.findByAltText('shot.png');
  expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
});

it('refuses to send while a chip has failed — it would drop the image silently', async () => {
  vi.spyOn(api, 'upload').mockRejectedValue(new ApiError(502, { error: 'nope' }));
  const onSend = vi.fn();
  render(<Composer onSend={onSend} pending={[]} id={ID} />);
  pick(new File(['tiny'], 'shot.png', { type: 'image/png' }));
  await screen.findByRole('button', { name: /retry/i });

  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'hi' } });
  expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  expect(onSend).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd infra/ccrc/pwa && npx vitest run test/attach.test.tsx` → FAIL.

- [ ] **Step 3: Implement**

In `Composer.tsx`: swap `useAttachImage` for `useStagedImages`, render the tray
inside `.composer` above `.inputbar`, and:

```tsx
  const staged = useStagedImages(id ?? '');
  const [dropping, setDropping] = useState(false);

  // Carries previewUrl, not just the path: the optimistic bubble renders the
  // same thumbnails the chips did, so chip -> pending -> confirmed never
  // flickers empty. Ownership of those URLs passes to the store on send.
  const attachments = staged.images
    .filter((i) => i.state === 'staged')
    .map((i) => ({ path: i.path!, previewUrl: i.previewUrl }));
  const canSend = !disabled && !staged.hasFailed && !staged.uploading
    && (value.trim() !== '' || attachments.length > 0);

  const send = (): void => {
    if (!canSend) return;
    const text = value.trim();
    onSend(text, attachments.length ? { attachments } : undefined);
    setValue('');
    staged.release();
  };
```

Paste becomes multi-image:

```tsx
  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>): void => {
    if (id === undefined || disabled) return;
    const files = clipboardImages(e.clipboardData);
    if (files.length === 0) return;      // an ordinary text paste — leave it alone
    e.preventDefault();
    staged.add(files);
  };
```

Drag-and-drop on the `.composer` div:

```tsx
      onDragOver={(e) => { if (id !== undefined && !disabled) { e.preventDefault(); setDropping(true); } }}
      onDragLeave={() => setDropping(false)}
      onDrop={(e) => {
        if (id === undefined || disabled) return;
        e.preventDefault();
        setDropping(false);
        staged.add(Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith('image/')));
      }}
      data-drop={dropping || undefined}
```

`AttachButton` gains `multiple` and takes `onPick: (files: File[]) => void`,
dropping its own hook instance.

- [ ] **Step 4: Run to verify it passes**

Run: `cd infra/ccrc/pwa && npx vitest run` → all pass.

- [ ] **Step 5: Commit**

```bash
git add infra/ccrc/pwa/src/session/Composer.tsx infra/ccrc/pwa/src/session/AttachButton.tsx \
        infra/ccrc/pwa/test/attach.test.tsx infra/ccrc/pwa/test/paste.test.tsx
git commit -m "feat(ccrc): composer owns the tray — drag, paste, multi-image, gated send"
```

---

## Task 12: PWA — attachments survive the whole send lifecycle

**Files:**
- Modify: `infra/ccrc/pwa/src/stores/session.ts`, `infra/ccrc/pwa/src/session/Composer.tsx`
- Test: `infra/ccrc/pwa/test/stores.test.ts`

**Interfaces:**
- Consumes: `composePrompt` (Task 1), `api.prompt` (Task 8).
- Produces:

```ts
export interface PendingAttachment { path: string; previewUrl?: string }
// on PendingSend:  attachments?: PendingAttachment[]
send(text: string, opts?: { replaceDraft?: boolean; attachments?: PendingAttachment[] }): Promise<void>
resolve(key: string, text: string, opts: { replaceDraft: boolean }): void
```

`ComposerProps.onSend` takes the same `PendingAttachment[]` (Task 11), so the
preview URLs reach the optimistic bubble. Only `dispatch` / `api.prompt` narrow
them to bare paths.

**One rule:** a staged image's identity and its object URL live with the
`PendingSend` from send until that pending is confirmed or explicitly abandoned,
and every re-dispatch reuses that record in place. Two holes this closes, both of
which orphan uploads and drop images with no error:

- `retry` re-lists fields in an object literal (`session.ts:264`) instead of
  spreading, so `attachments` vanishes. Reachable: stage images, send while a
  dialog is open → `dialog-open` 409 → failed pending, empty tray → Retry sends
  text alone.
- The draft-conflict sheet does `onDiscard(key); onSend(text, true)`
  (`Composer.tsx:129-134`) — discard revokes the preview URLs, and the re-send
  carries no attachments.

- [ ] **Step 1: Write the failing test**

Add inside the existing `describe('session store optimistic send')` in `stores.test.ts`:

```ts
const CLIP = { path: '/p/clip-1-a1b2.png', previewUrl: 'blob:mock/1' };

it('clears the pending when the echo arrives as paths-plus-text', async () => {
  const prompt = vi.fn().mockResolvedValue(undefined);
  const store = createSessionStore(ID, { api: { prompt } });
  await store.getState().send('hi', { attachments: [CLIP] });

  store.getState().apply({
    type: 'events', uuid: 'u1', offset: 1,
    events: [{ kind: 'user', uuid: 'e1', ts: NOW, text: `${CLIP.path}\nhi` }],
  });
  expect(store.getState().pending).toHaveLength(0);
});

it('keeps the attachments when a failed send is retried', async () => {
  const prompt = vi.fn().mockRejectedValueOnce(new ApiError(409, { error: 'dialog-open' }))
    .mockResolvedValueOnce(undefined);
  const store = createSessionStore(ID, { api: { prompt } });
  await store.getState().send('hi', { attachments: [CLIP] });
  const key = store.getState().pending[0]!.key;

  store.getState().retry(key);
  await vi.waitFor(() => expect(prompt).toHaveBeenCalledTimes(2));
  expect(prompt.mock.calls[1]).toEqual([ID, 'hi', { attachments: [CLIP.path] }]);  // narrowed
});

it('keeps the attachments when a draft conflict is resolved', async () => {
  const prompt = vi.fn().mockRejectedValueOnce(new ApiError(409, { error: 'draft-present', draft: 'x' }))
    .mockResolvedValueOnce(undefined);
  const store = createSessionStore(ID, { api: { prompt } });
  await store.getState().send('hi', { attachments: [CLIP] });
  const key = store.getState().pending[0]!.key;

  store.getState().resolve(key, 'x\nhi', { replaceDraft: true });
  await vi.waitFor(() => expect(prompt).toHaveBeenCalledTimes(2));
  expect(prompt.mock.calls[1]).toEqual([ID, 'x\nhi', { replaceDraft: true, attachments: [CLIP.path] }]);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd infra/ccrc/pwa && npx vitest run test/stores.test.ts` → FAIL.

- [ ] **Step 3: Implement**

```ts
      async send(text, opts = {}) {
        keySeq += 1;
        const key = `p${keySeq}`;
        set((s) => ({ pending: [...s.pending, {
          key, text, state: 'sending',
          replaceDraft: opts.replaceDraft, attachments: opts.attachments,
        }] }));
        await dispatch(key, text, opts);
      },

      retry(key) {
        const p = get().pending.find((x) => x.key === key);
        if (!p || p.state !== 'failed') return;
        // Spread, never re-list: the old object literal here is exactly why
        // `attachments` used to vanish on retry, and it would swallow every
        // field added after it too.
        set((s) => ({
          pending: s.pending.map((x) =>
            x.key === key ? { ...x, state: 'sending' as const, error: undefined, draft: undefined } : x),
        }));
        void dispatch(key, p.text, { replaceDraft: p.replaceDraft, attachments: pathsOf(p) });
      },

      /** Re-send a pending in place after a draft conflict — same record, so the
       *  attachments and their preview URLs survive. Replaces the old
       *  discard-then-send, which dropped both. */
      resolve(key, text, opts) {
        const p = get().pending.find((x) => x.key === key);
        if (!p) return;
        set((s) => ({
          pending: s.pending.map((x) =>
            x.key === key
              ? { ...x, text, state: 'sending' as const, error: undefined, draft: undefined,
                  replaceDraft: opts.replaceDraft }
              : x),
        }));
        void dispatch(key, text, { replaceDraft: opts.replaceDraft, attachments: pathsOf(p) });
      },
```

with, at module scope:

```ts
const pathsOf = (p: PendingSend): string[] | undefined =>
  p.attachments?.length ? p.attachments.map((a) => a.path) : undefined;

/** Object URLs die with the pending that owned them. */
const revoke = (p: PendingSend | undefined): void => {
  for (const a of p?.attachments ?? []) if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
};
```

`clearConfirmed` matches on the composed text:

```ts
    const i = next.findIndex(
      (p) => p.state === 'sending' && composePrompt(p.text, pathsOf(p) ?? []) === e.text,
    );
    if (i >= 0) { revoke(next[i]); next = [...next.slice(0, i), ...next.slice(i + 1)]; }
```

`discard` calls `revoke` too. In `Composer.tsx`, `resolveConflict` calls
`onResolve?.(conflict.key, text, { replaceDraft: true })` instead of
discard-then-send, and `DraftConflict` carries nothing new — the store owns it.

- [ ] **Step 4: Run to verify it passes**

Run: `cd infra/ccrc/pwa && npx vitest run` → all pass.

- [ ] **Step 5: Commit**

```bash
git add infra/ccrc/pwa/src/stores/session.ts infra/ccrc/pwa/src/session/Composer.tsx \
        infra/ccrc/pwa/test/stores.test.ts
git commit -m "fix(ccrc): attachments survive retry and draft conflicts"
```

---

## Task 13: PWA — thumbnails in the transcript

**Files:**
- Modify: `infra/ccrc/pwa/src/session/MessageBubble.tsx`, `infra/ccrc/pwa/src/session/ChatList.tsx`, `infra/ccrc/pwa/src/screens/SessionScreen.tsx`, `infra/ccrc/pwa/src/session/chat.css`
- Test: `infra/ccrc/pwa/test/chat.test.tsx`

**Interfaces:**
- Consumes: `splitClipPaths` (Task 1), `clipUrl` (Task 8), `PendingSend.attachments` (Task 12).
- Produces: `ChatListProps.id: string`; `MessageBubble({ event, id, streaming })`.

- [ ] **Step 1: Write the failing test**

```ts
it('renders a sent clip path as the image, not the path', () => {
  const P = '/home/u/.cc-clips/claude2-Proj/clip-20260726-150340-a1b2.png';
  render(<ChatListInner id="claude2-Proj" pending={[]} events={[
    { kind: 'user', uuid: 'u1', ts: NOW, text: `${P}\nwhat is this` },
  ]} />);

  const img = screen.getByRole('img', { name: 'clip-20260726-150340-a1b2.png' });
  expect(img).toHaveAttribute('src', `${location.origin}/api/sessions/claude2-Proj/clip/clip-20260726-150340-a1b2.png`);
  expect(screen.getByText('what is this')).toBeInTheDocument();
  expect(screen.queryByText(new RegExp(P))).not.toBeInTheDocument();
});

it('falls back to the filename when the clip is gone from disk', () => {
  const P = '/home/u/.cc-clips/claude2-Proj/clip-20260726-150340-a1b2.png';
  render(<ChatListInner id="claude2-Proj" pending={[]} events={[
    { kind: 'user', uuid: 'u1', ts: NOW, text: P },
  ]} />);
  fireEvent.error(screen.getByRole('img'));
  expect(screen.getByText('clip-20260726-150340-a1b2.png')).toBeInTheDocument();
});

it('leaves a message with no clip path alone', () => {
  render(<ChatListInner id="s" pending={[]} events={[
    { kind: 'user', uuid: 'u1', ts: NOW, text: 'just words' },
  ]} />);
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
});

it('shows the same thumbnails on the optimistic bubble, from the object URL', () => {
  // chip -> pending -> confirmed must never flicker empty, so the pending bubble
  // renders the blob it inherited rather than waiting on a server round trip.
  render(<ChatListInner id="claude2-Proj" events={[]} pending={[{
    key: 'p1', text: 'what is this', state: 'sending',
    attachments: [{ path: '/home/u/.cc-clips/claude2-Proj/clip-1-a1b2.png', previewUrl: 'blob:mock/1' }],
  }]} />);
  expect(screen.getByRole('img')).toHaveAttribute('src', 'blob:mock/1');
  expect(screen.getByText('what is this')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd infra/ccrc/pwa && npx vitest run test/chat.test.tsx` → FAIL (`id` is not a prop).

- [ ] **Step 3: Implement**

Thread `id` through `ChatList` / `ChatListInner` / `ChatItemView` to
`MessageBubble` and `PendingBubble`. In `MessageBubble`'s user branch:

```tsx
  if (event.kind === 'user') {
    const { paths, rest } = splitClipPaths(event.text);
    const time = timeOf(event.ts);
    return (
      <>
        {paths.length > 0 && <ClipThumbs id={id} paths={paths} />}
        {rest !== '' && <div className="msg-user">{linkify(rest)}</div>}
        <p className="msg-receipt msg-receipt--ok">
          {time} <b aria-label="delivered">✓</b>
        </p>
      </>
    );
  }
```

with a small shared component (used by `PendingBubble` too, against object URLs):

```tsx
/** Sent attachments. A clip deleted off disk must degrade to its name, never to
 *  a broken-image box. */
function ClipThumbs({ id, paths }: { id: string; paths: string[] }): ReactNode {
  const [broken, setBroken] = useState<Set<string>>(new Set());
  return (
    <div className="msg-attach" data-count={Math.min(paths.length, 2)}>
      {paths.map((p) => {
        const name = p.slice(p.lastIndexOf('/') + 1);
        if (broken.has(p)) return <span key={p} className="msg-attach-gone">{name}</span>;
        const href = clipUrl(id, name);
        return (
          <a key={p} href={href} className="msg-img-link" onClick={(e) => openExternal(e, href)}>
            <img
              src={href}
              alt={name}
              loading="lazy"
              className="msg-attach-img"
              onError={() => setBroken((s) => new Set(s).add(p))}
            />
          </a>
        );
      })}
    </div>
  );
}
```

Add `.msg-attach` / `.msg-attach-img` / `.msg-attach-gone` to `chat.css`
(`max-height: 220px`, radius `--r-md`, right-aligned, two-column grid at
`--sp-1`).

Finally, the toast offset — and note the wiring that *looks* right and silently
does nothing: `ToastHost` mounts outside the session subtree (`app.tsx:63`, a
sibling of `.app-shell`), so a custom property set on `.chat` can never reach it.

`SessionScreen.tsx`:

```tsx
  // Published on :root, not on .chat — ToastHost is not inside this subtree, and
  // custom properties only inherit downward. Cleared on unmount so the fleet
  // screen keeps the plain offset.
  useEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      document.documentElement.style.setProperty(
        '--composer-h', `${Math.round(entry!.contentRect.height)}px`);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      document.documentElement.style.removeProperty('--composer-h');
    };
  }, []);
```

`tokens.css`, beside `--safe-bottom`:

```css
  /* Live composer height, published by SessionScreen. The 0px default is
     load-bearing: an unset var() inside calc() invalidates the whole
     declaration, which would cost the fleet screen its toast offset entirely. */
  --composer-h: 0px;
```

`primitives.css`:

```css
  bottom: calc(var(--sp-6) + var(--safe-bottom) + var(--composer-h, 0px));
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd infra/ccrc/pwa && npx vitest run` → all pass.
Run: `cd infra/ccrc/pwa && npm run build` → clean.

- [ ] **Step 5: Commit**

```bash
git add infra/ccrc/pwa/src/session/MessageBubble.tsx infra/ccrc/pwa/src/session/ChatList.tsx \
        infra/ccrc/pwa/src/screens/SessionScreen.tsx infra/ccrc/pwa/src/session/chat.css \
        infra/ccrc/pwa/src/styles/tokens.css infra/ccrc/pwa/src/components/primitives.css \
        infra/ccrc/pwa/test/chat.test.tsx
git commit -m "feat(ccrc): sent screenshots render as images, and toasts clear the composer"
```

---

## Task 14: Full-stack verification

**Files:** none (verification only).

- [ ] **Step 1: Every suite**

```bash
(cd infra/ccrc/server && npx vitest run)
(cd infra/ccrc/agent  && npx vitest run)
(cd infra/ccrc/pwa    && npx vitest run)
```
Expected: all green, and each count **≥** its baseline (173 / 82 / 169).

- [ ] **Step 2: Build and gates**

```bash
(cd infra/ccrc/pwa && npm run build && node design/contrast-check.mjs)
(cd infra/ccrc/server && npx tsc --noEmit)
(cd infra/ccrc/agent && npx tsc --noEmit)
```
Expected: build clean, `ALL 74 PASS`, no type errors.

- [ ] **Step 3: Manual check against a live session**

Deploy, then in the PWA: paste a screenshot → chip appears with `W×H` → remove it
→ paste two → send with text. Confirm in the terminal that the box received both
paths and the text as **one** turn, that no draft-conflict sheet appeared, and
that the sent bubble shows thumbnails rather than paths.

- [ ] **Step 4: Commit any fixes, then merge**

```bash
git add -u && git commit -m "test(ccrc): full-stack verification for the attachment tray"
```
