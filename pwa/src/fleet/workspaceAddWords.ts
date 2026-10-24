// Every way `POST /api/projects/:project/workspaces` can say no, read once and said in its own sentence (named
// workspaces S7/S8, design 2026-10-20 §4.2). L1: pure, no I/O. The sheets keep the operator's text on EVERY one of
// these and show the sentence beside the field, so what matters here is that no two refusals read alike and that
// none of them shows the server's own text except ccd's stderr (the 502, which is all the operator has to go on).
//
// TWO FUNCTIONS, ON PURPOSE. `classifyAddError` turns what was thrown into a typed refusal (it is the wire reader:
// status AND word, never a status alone: 400 means five different things here); `addRefusalText` turns that into
// the sentence. The class is what a sheet branches on (an account refusal returns the operator to the account
// step); the sentence is what it shows.
import { ApiError } from '../lib/apiError';
import { isRecord } from '../lib/wire';
import { accountLabel } from '../lib/accounts';
import type { RosterWire } from '../../../shared/api';
import { NAME_REFUSAL_TEXT, isNameRefusal, workspaceId, type NameRefusal } from '../../../shared/slug';

/** The `ccd caps` tokens a 501 `unsupported` names in `needs`. */
export type AddNeeds = 'ws-title-v1' | 'ws-wrapper-v1';

/** The sentence for a request the server could not read, said by every name door (the create's and the rename's). */
export const BAD_REQUEST_TEXT = "That request wasn't understood. Reload the page and try again.";

export type AddRefusal =
  | { kind: 'bad-request' }
  | { kind: 'bad-project' }
  | { kind: 'name-too-long' }
  /** The project plus the name's slug would pass ccd's id cap, so nothing was created. */
  | { kind: 'id-too-long' }
  /** `reason` is null for a word this build does not know: the sentence is then the generic one. */
  | { kind: 'bad-name'; reason: NameRefusal | null }
  | { kind: 'bad-wrapper' }
  | { kind: 'bad-slug' }
  | { kind: 'slug-taken' }
  /**
   * ccd's own `<lane>:<why>`, kept whole: the sentence is built from its two halves. `leftBehind` is the server's
   * reading of ccd's EXIST clause: the refusal came after the worktree and branch were made, so they remain with no
   * session. Absent on the wire means nothing was created (the pre-flight refusal).
   */
  | { kind: 'account-refused'; reason: string; leftBehind: boolean }
  /** `needs` is null when the 501 named no token (a routing class the box cannot parse yet). */
  | { kind: 'unsupported'; needs: AddNeeds | null }
  /** The fleet box ran ccd and ccd failed: its stderr, trimmed, or null when there was none to show. */
  | { kind: 'ccd-failed'; stderr: string | null }
  /** The request never produced an answer (offline, a dropped connection): the create may or may not have landed. */
  | { kind: 'unreached' }
  /** An answer this build has no word for. The status is kept for the sentence. */
  | { kind: 'other'; status: number };


export function classifyAddError(err: unknown): AddRefusal {
  if (!(err instanceof ApiError)) return { kind: 'unreached' };
  const body = isRecord(err.body) ? err.body : {};
  const word = typeof body.error === 'string' ? body.error : null;
  if (err.status === 400) {
    switch (word) {
      case 'bad-request': return { kind: 'bad-request' };
      case 'bad-project': return { kind: 'bad-project' };
      case 'name-too-long': return { kind: 'name-too-long' };
      case 'id-too-long': return { kind: 'id-too-long' };
      case 'bad-name': return { kind: 'bad-name', reason: isNameRefusal(body.reason) ? body.reason : null };
      case 'bad-wrapper': return { kind: 'bad-wrapper' };
      case 'bad-slug': return { kind: 'bad-slug' };
    }
  }
  if (err.status === 409) {
    if (word === 'slug-taken') return { kind: 'slug-taken' };
    if (word === 'account-refused') {
      return {
        kind: 'account-refused',
        reason: typeof body.reason === 'string' && body.reason !== '' ? body.reason : 'refused',
        leftBehind: body.leftBehind === true,
      };
    }
  }
  if (err.status === 501 && word === 'unsupported') {
    return { kind: 'unsupported', needs: body.needs === 'ws-title-v1' || body.needs === 'ws-wrapper-v1' ? body.needs : null };
  }
  if (err.status === 502) {
    const stderr = typeof body.stderr === 'string' ? body.stderr.trim() : '';
    return { kind: 'ccd-failed', stderr: stderr === '' ? null : stderr };
  }
  return { kind: 'other', status: err.status };
}

/** What a sentence may name: the project, the slug the operator asked for (null when they asked for none), the roster for labels. */
export interface AddContext {
  /** Which door asked: what "clear the name" does differs (the `+` adds an automatically named workspace, the
   *  new-session sheet starts on the main checkout), and the sentence that offers it must say the true one. */
  door: 'plus' | 'new-session';
  project: string;
  slug: string | null;
  roster: readonly RosterWire[];
  /** The refusal arrived after its sheet was dismissed, so it is said once as a toast with no sheet behind it: a
   *  sentence that promises the open sheet's text, account step or field ("Your text is kept", "Pick another
   *  account", "change the name") is then false, and each such arm says what is true without one. Absent: the open sheet's. */
  dismissed?: boolean;
}

/**
 * ccd's per-lane reason (`_ws_wrapper_why`: `<lane>:<why>`) as a sentence. The `why` words are ccd's:
 * `not-home-able`, `auth-dead`, `missing`, `disabled`, `pool=<name>`, `projection=<word>`, `class=<class>-unservable`,
 * and, with the lane slot holding `tag`, `tag:<state> <file>` for a project whose pool tag cannot be read (the file
 * path is the fleet box's and is never shown). A word this build does not know is shown as ccd wrote it, beside the
 * lane, never swallowed.
 */
export function accountRefusedText(reason: string, roster: readonly RosterWire[]): string {
  const at = reason.indexOf(':');
  const lane = at === -1 ? '' : reason.slice(0, at);
  const why = at === -1 ? reason : reason.slice(at + 1);
  if (lane === 'tag') return "This project's pool tag can't be read on the fleet box, so no account can be chosen for it.";
  const who = lane === '' ? 'That account' : accountLabel(roster, lane);
  if (why === 'not-home-able') return `${who} is an overflow account, and workspaces don't start there.`;
  if (why === 'auth-dead') return `${who} can't sign in right now.`;
  if (why === 'missing') return `${who} isn't set up on the fleet box.`;
  if (why === 'disabled') return `${who} is switched off.`;
  if (why.startsWith('pool=')) return `${who} is in pool ${why.slice('pool='.length)}, which isn't this project's pool.`;
  if (why.startsWith('projection=')) return `${who}'s pool can't be checked on the fleet box right now (${why.slice('projection='.length)}).`;
  const cls = /^class=(.+)-unservable$/.exec(why);
  if (cls !== null) return `${who} can't serve the ${cls[1]} class today.`;
  return `${who} can't take a new workspace (${why}).`;
}

const NEEDS_TEXT: Record<AddNeeds, string> = {
  'ws-title-v1': "The fleet box's ccd is too old to name a workspace. Update the fleet box, or clear the name to add one with an automatic name.",
  'ws-wrapper-v1': "The fleet box's ccd is too old to start a named workspace on the account you picked. Update the fleet box, or clear the name to start on the main checkout.",
};

/** The new-session door's own `ws-title-v1` sentence: clearing the name there starts on the main checkout, not an automatic workspace. */
const NEW_SESSION_TITLE_NEEDS_TEXT = "The fleet box's ccd is too old to name a workspace. Update the fleet box, or clear the name to start on the main checkout.";

/** The sentence for a refusal whose sheet was dismissed: what happened to the workspace and what is on the board, and
 *  never an instruction for a field that is gone. An arm with nothing to say about a sheet is `null`, and falls through
 *  to `addRefusalText`'s own. */
function dismissedRefusalText(r: AddRefusal, ctx: AddContext): string | null {
  switch (r.kind) {
    case 'name-too-long': return "That name was too long, so the workspace wasn't created.";
    case 'id-too-long': return `${ctx.project} plus that name makes an id too long for the fleet box, so the workspace wasn't created.`;
    case 'bad-name': return "That name couldn't be used, so the workspace wasn't created.";
    case 'bad-wrapper': return "That account name wasn't valid, so the workspace wasn't created.";
    case 'bad-slug': return "The fleet box refused that name's short form, so the workspace wasn't created.";
    case 'slug-taken': return ctx.slug === null
      ? 'A workspace with that name already exists. Open it from the board.'
      : `${workspaceId(ctx.project, ctx.slug)} already exists. Open it from the board.`;
    case 'account-refused': return r.leftBehind ? null : `${accountRefusedText(r.reason, ctx.roster)} Nothing was created.`;
    case 'unsupported': return r.needs === null
      ? "The fleet box's ccd doesn't support that yet. Update the fleet box."
      : r.needs === 'ws-title-v1' ? "The fleet box's ccd is too old to name a workspace. Update the fleet box."
        : "The fleet box's ccd is too old to start a named workspace on the account you picked. Update the fleet box.";
    default: return null;
  }
}

/** One sentence per refusal, none a prefix of another (`workspace-add-words.test.ts` holds the set apart). */
export function addRefusalText(r: AddRefusal, ctx: AddContext): string {
  if (ctx.dismissed === true) {
    const said = dismissedRefusalText(r, ctx);
    if (said !== null) return said;
  }
  switch (r.kind) {
    case 'bad-request': return BAD_REQUEST_TEXT;
    case 'bad-project': return `"${ctx.project}" isn't a project a workspace can be added to.`;
    case 'name-too-long': return 'That name is too long. Shorten it, or paste just the ticket id.';
    case 'id-too-long': return `${ctx.project} plus that name makes an id too long for the fleet box. Shorten the name.`;
    case 'bad-name': return r.reason === null ? "That name can't be used. Change it and try again." : NAME_REFUSAL_TEXT[r.reason];
    case 'bad-wrapper': return "That account name isn't valid. Pick the account again.";
    case 'bad-slug': return "The fleet box refused that name's short form. Try a different name.";
    case 'slug-taken': return ctx.slug === null
      ? 'A workspace with that name already exists. Open it from the board, or change the name. Your text is kept.'
      : `${workspaceId(ctx.project, ctx.slug)} already exists. Open it from the board, or change the name. Your text is kept.`;
    case 'account-refused': return r.leftBehind
      // ccd's own remedy for what it left (`cmd_ws_add`): adopt the worktree and branch onto a working account. A retry
      // of the same name reads `slug-taken`, because the slug is on disk though no row names it, so that is said too.
      ? `${accountRefusedText(r.reason, ctx.roster)} The worktree and branch for ${ctx.slug === null ? 'this workspace' : workspaceId(ctx.project, ctx.slug)} were already made and are still on the fleet box with no session. Fix the account or pick another, then adopt them there with: ccd start <account> ${ctx.project} <worktree>. Adding the same name again will say it already exists.`
      : `${accountRefusedText(r.reason, ctx.roster)} Pick another account. Nothing was created.`;
    case 'unsupported': return r.needs === null
      ? "The fleet box's ccd doesn't support that yet. Update the fleet box, or change the options."
      : r.needs === 'ws-title-v1' && ctx.door === 'new-session' ? NEW_SESSION_TITLE_NEEDS_TEXT : NEEDS_TEXT[r.needs];
    case 'ccd-failed': return r.stderr === null
      ? "The fleet box couldn't create the workspace, and gave no reason."
      : `The fleet box couldn't create the workspace: ${r.stderr}`;
    case 'unreached': return "Couldn't reach the server, so the workspace may not have been created. Check the board before trying again.";
    case 'other': return `The workspace wasn't created (the server answered ${r.status}).`;
  }
}
