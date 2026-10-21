/**
 * The decisions of the operator's workspace create (`POST /api/projects/:project/workspaces`), made once and without
 * I/O (named workspaces S5, design 2026-10-20 §4.2). L1 policy, C4 Workspace & PR Lifecycle: the route (L4) reads the
 * body and the deployed ccd's caps, asks `planCreate` what to do, looks the title up, runs ccd, and asks
 * `classifyAddFailure` what ccd's refusal MEANS. It decides nothing itself.
 *
 * TWO CALLERS' SHAPES, ONE ROUTE. A body with no usable name is TODAY'S create, argv for argv and answer for answer:
 * the PWA's `+` has always posted `{}` or `{route}`, and the additivity proof is that nothing here can touch that path
 * (`plain`). A body with a name is a NAMED create, and every way it can be refused is decided here, BEFORE any argv
 * exists — the project segment included, because `cmd_ws_add`'s strip loop eats a flag-shaped token from any position
 * (a request for project `--no-rc` once built an argv that ccd bound to the wrong project and exited 0).
 */
import { WS_TITLE_CAP, WS_WRAPPER_CAP } from './ccdargv.js';
import { ACCOUNT_ID_RE } from '../../shared/roster.js';
import type { WsCreateRefusal } from '../../shared/refusal.js';
import {
  deriveWorkspaceSlug, isWsProject, NAME_REFUSAL_TEXT, WS_ID_MAX, workspaceId, type NameRefusal, type SlugAsk,
} from '../../shared/slug.js';

/**
 * The longest name the server will parse. A pasted issue URL is about a hundred characters and a copied branch name a
 * little more; a kilobyte is generous for both and still a bound on what an authenticated caller can make the slug
 * grammar chew on. Characters, not bytes. The preview read (`GET /api/linear/resolve`) and the create share it, so a
 * name the sheet previewed is never refused for its length at Start.
 */
export const LINEAR_REF_MAX_CHARS = 1024;

/** Which `ccd caps` tokens the deployed box advertised, read by the route with `capSupported` (no evidence = false). */
export interface CreateCaps { title: boolean; wrapper: boolean }

/**
 * A refusal, ready for `refuseRoute`: the word (its one status is `REFUSAL_STATUS`'s) and its extra fields. Fixed words
 * only; nothing the operator typed is echoed.
 */
export interface CreateRefusal {
  error: WsCreateRefusal | 'bad-request' | 'unsupported';
  extra: { reason?: NameRefusal; detail?: string; needs?: string };
}

export type CreatePlan =
  /** No usable name: today's `CCD_ARGV.wsAdd`, today's `{ok:true}`. `wrapper` is ignored here, as pinned. */
  | { kind: 'plain' }
  | { kind: 'refuse'; refusal: CreateRefusal }
  /** A named create. `name` is the operator's text, untrimmed; `ask` is the grammar's answer for it (slug, ticket). */
  | { kind: 'named'; name: string; ask: Extract<SlugAsk, { kind: 'named' }>; wrapper: string | null };

const refuse = (error: CreateRefusal['error'], extra: CreateRefusal['extra'] = {}): CreatePlan =>
  ({ kind: 'refuse', refusal: { error, extra } });

/** `name` and `wrapper`, when present at all, are strings. `null` is not "absent": it is refused like any non-string. */
const isAbsentOrString = (v: unknown): v is string | undefined => v === undefined || typeof v === 'string';

/**
 * A wrapper the roster's own grammar could name (`ACCOUNT_ID_RE`), and one that cannot lead with `-` or `.`. Only the
 * SHAPE is checked here: whether the box has that account, and whether it can take a workspace, is ccd's to answer
 * (`--wrapper refused`), because this server's roster is one of two copies.
 */
export const isWsWrapper = (s: string): boolean => ACCOUNT_ID_RE.test(s) && !s.startsWith('-') && !s.startsWith('.');

/**
 * What to do with this request's `name`/`wrapper`. Order, each step before the next can cost anything:
 *   1. a non-string `name` or `wrapper` is `400 bad-request`, whatever else the body says;
 *   2. a blank (or whitespace-only) name is the plain create, and `wrapper` is ignored;
 *   3. a project that is not `isWsProject` is `400 bad-project`;
 *   4. a name past `LINEAR_REF_MAX_CHARS` is `400 name-too-long`, a refused name `400 bad-name` with its reason;
 *   5. a project plus slug past ccd's id cap is `400 id-too-long`; a wrapper outside the grammar is `400 bad-wrapper`;
 *   6. a wrapper without `ws-wrapper-v1`, or a name without `ws-title-v1`, is `501 unsupported` naming the token.
 *      Never a silent drop: a dropped `--wrapper` would place the workspace on the least-loaded lane, not the chosen one.
 */
export function planCreate(project: string, body: { name?: unknown; wrapper?: unknown }, caps: CreateCaps): CreatePlan {
  const { name, wrapper } = body;
  if (!isAbsentOrString(name) || !isAbsentOrString(wrapper)) return refuse('bad-request');
  if (name === undefined || name.trim() === '') return { kind: 'plain' };

  if (!isWsProject(project)) return refuse('bad-project');
  if (name.length > LINEAR_REF_MAX_CHARS) return refuse('name-too-long');

  const ask = deriveWorkspaceSlug(name);
  // `auto` is a blank name, answered above; a non-blank name never derives it.
  if (ask.kind !== 'named') {
    const reason: NameRefusal = ask.kind === 'refused' ? ask.reason : 'no-usable-characters';
    return refuse('bad-name', { reason, detail: NAME_REFUSAL_TEXT[reason] });
  }

  // ccd's id cap, before any argv: `cmd_ws_add` refuses an id past it with nothing made, and that would arrive as a 502.
  if (workspaceId(project, ask.slug).length > WS_ID_MAX) return refuse('id-too-long');

  if (wrapper !== undefined && !isWsWrapper(wrapper)) return refuse('bad-wrapper');
  if (wrapper !== undefined && !caps.wrapper) return refuse('unsupported', { needs: WS_WRAPPER_CAP });
  if (!caps.title) return refuse('unsupported', { needs: WS_TITLE_CAP });

  return { kind: 'named', name, ask, wrapper: wrapper ?? null };
}

/** What ccd's refusal of a named create means, in the words the route answers with. */
export type AddFailure =
  | { kind: 'slug-taken' }
  | { kind: 'bad-slug' }
  /**
   * `reason` is ccd's own per-lane reason (`<lane>:<why>`), the words the no-placement message already uses.
   * `leftBehind` is ccd's own EXIST clause: the refusal came AFTER the worktree and branch were made, so they remain
   * with no registry row (the pre-flight refusal touches nothing). Same word, opposite fact, never folded.
   */
  | { kind: 'account-refused'; reason: string; leftBehind: boolean }
  | { kind: 'other' };

const WRAPPER_REFUSED = '--wrapper refused — ';
const WRAPPER_REFUSED_TAIL = '; the account was named';
/** `cmd_ws_add`'s post-worktree refusal names what it left: "The worktree … and the branch … EXIST and no registry row names them". */
const LEFT_BEHIND = 'EXIST and no registry row names them';

/**
 * Read ccd's `die` line. A transport failure (`ran === false`) is NEVER a refusal and is `other` whatever its text
 * says: the runner's own stderr is not ccd's verdict (CLAUDE.md's "no overloaded null at a seam").
 *
 * `slug in use: ` and `invalid slug '` are `cmd_ws_add`'s own sentences; `--wrapper refused — <lane>:<why>; the
 * account was named …` is `_ws_wrapper_why`'s, in the pre-flight and again after the worktree exists. The reason is
 * the text between the marker and that tail, or the rest of the line when ccd's tail changes — never empty.
 * The post-worktree sentence also says the worktree and branch EXIST; that is `leftBehind`, and it is never dropped.
 */
export function classifyAddFailure(res: { ran?: boolean; stderr: string }): AddFailure {
  if (res.ran === false) return { kind: 'other' };
  const err = res.stderr;
  const at = err.indexOf(WRAPPER_REFUSED);
  if (at !== -1) {
    const rest = err.slice(at + WRAPPER_REFUSED.length).split('\n')[0] ?? '';
    const cut = rest.indexOf(WRAPPER_REFUSED_TAIL);
    const reason = (cut === -1 ? rest : rest.slice(0, cut)).trim();
    return { kind: 'account-refused', reason: reason === '' ? 'refused' : reason, leftBehind: err.includes(LEFT_BEHIND) };
  }
  if (err.includes('slug in use: ')) return { kind: 'slug-taken' };
  if (err.includes("invalid slug '")) return { kind: 'bad-slug' };
  return { kind: 'other' };
}
