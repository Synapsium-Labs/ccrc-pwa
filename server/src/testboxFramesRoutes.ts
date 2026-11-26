// The box frames recipe's ONE read (Desktop polish wave 187; plan docs/superpowers/plans/2026-11-26-box-frames-recipe.md
// section 5.4; the capture owner's call 1558 and its yes to packet 1). L4: a lane source of its own, registered beside the
// test box status read (`coord/routes.ts`). It writes nothing. What it answers is `shared/framesLane.ts#framesListOf`'s and
// the stored row's; the one check it runs again before a text leaves is the reducer's own (`framesReduce.ts`), with the
// product's live masker beside it.
//
// CREDENTIALS: a live session, or the box token (`ccrc-api testbox frames`, a cookieless fleet-host caller), checked
// before anything is read, and checked even while sign-in is dark: the status read answers anyone then, this one never.
// With neither it answers 401.
//
// THE QUERY IS CLOSED (the capture owner's addition): exactly `build`, and optionally `frame`, each once and not empty. Any
// other key, a repeated key or an empty value is a bad request before the store is read.
//   ?build=<b>              the list: every stored frame's record with NO TEXT, and the parts with no current row
//   ?build=<b>&frame=<id>   one frame: its row and its reduced text, or no text and why
// So no answer is larger than one frame. The answer passes the one answer hook too (`MASKED_GET_ROUTES`).
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { isClaudeVersion } from '../../shared/claudeVersion.js';
import { framesOurs } from '../../shared/framesCapture.js';
import { framesListOf, type FramesRow } from '../../shared/framesLane.js';
import { checkReducedFrame } from '../../shared/framesReduce.js';
import { FRAMES_PARTS, framesPartOfId, readFramesCaptureResult } from '../../shared/framesResult.js';
import { framesScan } from '../../shared/framesScan.mjs';
import type { SecretMasker } from './accounts/mask.js';

/** The route's path, its one spelling. */
export const TESTBOX_FRAMES_ROUTE = '/api/testbox/frames';

/** The refusal words, each its own. */
export type FramesReadRefusal = 'unauthenticated' | 'bad-request' | 'bad-build' | 'bad-frame' | 'no-text' | 'unreadable' | 'not-configured';

export interface TestboxFramesDeps {
  /** The store's rows, read fresh; absent: no coordination store. A throw is `unreadable`. */
  readonly frames: (() => readonly FramesRow[]) | undefined;
  /** Whether the request carries a live session, or a valid box token. */
  readonly session: (req: FastifyRequest) => boolean;
  readonly boxToken: (req: FastifyRequest) => boolean;
  readonly masker: Pick<SecretMasker, 'maskText'>;
}

/** THE closed query rule: `{build}` or `{build, frame}`, each a non-empty single string. */
export function readFramesQuery(q: unknown): { readonly build: string; readonly frame: string | null } | null {
  if (typeof q !== 'object' || q === null || Array.isArray(q)) return null;
  const o = q as Record<string, unknown>;
  const keys = Object.keys(o).sort().join();
  if (keys !== 'build' && keys !== 'build,frame') return null;
  const one = (v: unknown): v is string => typeof v === 'string' && v !== '';
  if (!one(o['build']) || (keys === 'build,frame' && !one(o['frame']))) return null;
  return { build: o['build'], frame: keys === 'build,frame' ? (o['frame'] as string) : null };
}

const no = (reply: FastifyReply, code: number, error: FramesReadRefusal): FastifyReply => reply.code(code).send({ ok: false, error });

export function registerTestboxFramesRoute(app: FastifyInstance, d: TestboxFramesDeps): void {
  // The path is written out, not the constant: the gate suite's source scan reads every route by its literal path.
  app.get('/api/testbox/frames', async (req, reply) => {
    if (!d.session(req) && !d.boxToken(req)) return no(reply, 401, 'unauthenticated');
    const q = readFramesQuery(req.query);
    if (q === null) return no(reply, 400, 'bad-request');
    if (!isClaudeVersion(q.build)) return no(reply, 400, 'bad-build');
    const part = q.frame === null ? null : framesPartOfId(q.frame);
    if (q.frame !== null && part === null) return no(reply, 400, 'bad-frame');
    if (d.frames === undefined) return no(reply, 503, 'not-configured');
    let rows: readonly FramesRow[];
    try { rows = d.frames(); } catch (err) {
      console.warn(`ccrc-server: GET ${TESTBOX_FRAMES_ROUTE}: the frames store could not be read (${err instanceof Error ? err.message : String(err)})`);
      return no(reply, 503, 'unreadable');
    }
    const list = framesListOf(rows, q.build);
    if (part === null) return reply.code(200).send({ ok: true, build: q.build, frames: list.frames, unmeasured: list.unmeasured });
    const row = list.frames.find((f) => f.part === part);
    const stored = rows.find((r) => r.build === q.build && r.part === part);
    if (row === undefined || stored === undefined || stored.record === null || stored.text === null || !row.hasText) return no(reply, 404, 'no-text');
    // Served only as a whole result the one reader accepts, and only past the reducer's own check and the live masker,
    // run again here (the capture owner's condition 1): a text that fails goes out as its row and its word, never changed.
    const p = FRAMES_PARTS[part]!;
    const whole = readFramesCaptureResult({ ...stored.record, frame: { ...stored.record.frame, text: stored.text } }, q.build, part);
    const check = whole === null ? { ok: false as const, refusal: 'not-a-frame' as const }
      : checkReducedFrame(stored.text, p.pane, framesOurs(p.case, p.pane), framesScan, (t) => d.masker.maskText(t, { rows: true }) !== t);
    if (!check.ok) {
      console.warn(`ccrc-server: GET ${TESTBOX_FRAMES_ROUTE}: ${q.build} frame ${q.frame} refused by the read's check (${check.refusal}); no text served`);
      return reply.code(200).send({ ok: true, build: q.build, row, text: null, refused: check.refusal });
    }
    return reply.code(200).send({ ok: true, build: q.build, row, text: stored.text });
  });
}
