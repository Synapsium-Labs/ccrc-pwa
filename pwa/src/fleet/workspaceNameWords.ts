// What the "Name or Linear ticket" field shows under itself (named workspaces S7, design 2026-10-20 §2, §5): the
// slug the operator will get, the title the board will show, where that title came from, and every way it can have
// fallen back to what they typed. L1, pure words and decisions, no I/O: `useNamePreview` (the hook) owns the debounce
// and the call, this file owns what each answer MEANS.
//
// TWO SOURCES, ONE ANSWER. The slug and the offline title come from `shared/slug.ts` — the very functions the server
// validates the create with — so the preview cannot disagree with what is sent. The server's
// `GET /api/linear/resolve` only ever adds one thing, the real title of a ticket, and only for a name that parses as
// one (`ask.ticket !== null`): a plain name is answered here, with no request.
//
// NEVER A GATE. Every fallback keeps the title the operator typed and leaves the create open: "Linear is a lookup,
// never a gate" (design §In short). A refusal here is the GRAMMAR's (`NameRefusal`), never Linear's.
import { LINEAR_FAILURES, type LinearFailure } from '../../../shared/linear';
import { NAME_REFUSAL_TEXT, deriveWorkspaceSlug, offlineTitle, sanitizeTitle, type NameRefusal } from '../../../shared/slug';

/** The two notes that are this client's: the preview call itself failed, or answered a word this build does not know. */
type ClientNote = 'unrecognised' | 'call-failed';

/**
 * Why a ticket's title fell back to the typed text, and the one sentence for each. The server's `LinearFailure` words,
 * which `GET /api/linear/resolve` carries as `reason` (`shared/linear.ts`'s `LINEAR_FAILURES`, the one list), and the two
 * that are this client's (`ClientNote`). `satisfies Record<…>` over both, so a word without its sentence, or a sentence
 * for a word that is not one, is a compile error.
 *
 * `pointer` is set where the remedy is in Settings: the field then offers the way there.
 */
export const LOOKUP_NOTE = {
  'not-configured': { hint: "Linear isn't connected, so the title is what you entered.", pointer: 'Connect Linear in Settings' },
  'unauthorised': { hint: 'Linear rejected the saved key, so the title is what you entered.', pointer: 'Replace the key in Settings' },
  // A 403 is Linear refusing THIS request (a scope, or a team the key cannot see), not a verdict on the key, so the
  // note is quiet: no pointer to replace a key nobody called bad.
  'forbidden': { hint: "Linear wouldn't let this key read that issue, so the title is what you entered.", pointer: null },
  'not-found': { hint: 'Linear has no issue with that id, so the title is what you entered.', pointer: null },
  'timeout': { hint: 'Linear took too long to answer, so the title is what you entered.', pointer: null },
  'unreachable': { hint: "Couldn't reach Linear, so the title is what you entered.", pointer: null },
  'malformed': { hint: "Linear's answer wasn't usable, so the title is what you entered.", pointer: null },
  'unrecognised': { hint: "Linear's lookup said something this app doesn't know, so the title is what you entered.", pointer: null },
  'call-failed': { hint: "Couldn't check Linear just now, so the title is what you entered. The server asks again when you add it.", pointer: null },
} as const satisfies Record<LinearFailure | ClientNote, { hint: string; pointer: string | null }>;

export type LookupNote = keyof typeof LOOKUP_NOTE;

/** The words the server's `reason` can be; the two client-side notes are not on its wire. */
export type ResolveReason = LinearFailure;

export const isResolveReason = (v: unknown): v is ResolveReason => (LINEAR_FAILURES as readonly unknown[]).includes(v);

/** What `GET /api/linear/resolve` answered for a name that parsed, as `lib/api.ts` reads it. The title is the one
 *  the create will use whenever Linear answers (the route resolves it again, with the same function). */
export interface ResolveRead {
  title: string;
  source: 'linear' | 'offline';
  /** The failure arm of an offline answer; null when nothing failed. */
  note: LookupNote | null;
}

/**
 * Where the shown title stands. `none` is a plain name: nothing to look up, and no badge. `pending` is a ticket whose
 * lookup has not answered (the title shown is the offline one). `linear` and `offline` are answers.
 */
export type Lookup = 'none' | 'pending' | 'linear' | 'offline';

export type NamePreview =
  /** An empty field: today's behaviour, exactly. The caller sends no name. */
  | { kind: 'empty' }
  | { kind: 'refused'; reason: NameRefusal; text: string }
  | {
      kind: 'named';
      slug: string;
      /** The name did not fit the slug's 31 characters, so the slug is a shortened form of it. */
      shortened: boolean;
      title: string;
      /** The few characters a confirm button can carry: a ticket's id, else the title. */
      short: string;
      lookup: Lookup;
      note: LookupNote | null;
    };

/** `ENG-1234 - Fix the login flow` → `ENG-1234`; anything else is its own short form. */
const TITLE_ID = /^([A-Za-z][A-Za-z0-9]{0,9}-[0-9]{1,7})(?: - |$)/;
export const shortTitle = (title: string): string => TITLE_ID.exec(title)?.[1] ?? title;

/**
 * The preview with no network: refusal and slug are final, the title is the offline one, and a ticket is `pending`
 * until its lookup answers. The grammar's `refused` arm is shown at once, which is why the sheet can disable its
 * confirm with nothing sent.
 */
export function localPreview(value: string): NamePreview {
  const ask = deriveWorkspaceSlug(value);
  if (ask.kind === 'auto') return { kind: 'empty' };
  if (ask.kind === 'refused') return { kind: 'refused', reason: ask.reason, text: NAME_REFUSAL_TEXT[ask.reason] };
  // `offlineTitle` is null only for an empty or refused name, which `ask` is not; the typed text is the safe reading.
  // SANITISED AND CAPPED exactly as the create saves it (`sanitizeTitle`, the one function both sides call), so the
  // title the sheet shows is the title the board gets: a name past the byte cap reads here as it will be saved, ending in "…".
  const title = sanitizeTitle(offlineTitle(value) ?? value.trim());
  return {
    kind: 'named', slug: ask.slug, shortened: ask.shortened, title, short: shortTitle(title),
    lookup: ask.ticket === null ? 'none' : 'pending', note: null,
  };
}

/** Whether this preview is waiting on, or worth, a lookup: a named ticket that has not been asked about yet. */
export const needsLookup = (p: NamePreview): boolean => p.kind === 'named' && p.lookup === 'pending';

/**
 * The preview once its lookup has answered, or failed (`'call-failed'`). Anything that is not a pending ticket
 * is returned as it was: an answer for a name the field no longer holds must never repaint a different one.
 */
export function withLookup(p: NamePreview, answer: ResolveRead | 'call-failed'): NamePreview {
  if (p.kind !== 'named' || p.lookup !== 'pending') return p;
  if (answer === 'call-failed') return { ...p, lookup: 'offline', note: 'call-failed' };
  return {
    ...p, title: answer.title, short: shortTitle(answer.title), lookup: answer.source, note: answer.source === 'linear' ? null : answer.note,
  };
}

/** The confirm's label for a door: "Add workspace" / "Start project-a on lane-a" with nothing typed, the name in it once something is. */
export function confirmLabel(p: NamePreview, door: { empty: string; named: (short: string) => string }): string {
  if (p.kind === 'empty') return door.empty;
  if (p.kind === 'refused') return 'Fix the name to continue';
  return door.named(p.short);
}

/** Where the field's Settings pointer goes: Settings → Security, which holds the Linear section. Held equal to the
 *  route table's own path for that page by `add-workspace-sheet.test.tsx`. */
export const LINEAR_SETTINGS_PATH = '/settings/security';

/**
 * Why the NEW-SESSION door cannot take a name for this pick, or `null` when it can (named workspaces S8, design §2.1).
 * Two conditions, each its own sentence, never one boolean: the operator's remedy differs (pick a project in this
 * account's pool; pick another account). The first wins when both hold, as it is the one the project step can fix.
 *
 *   * `crossing`: the project is in another pool than the account's. `ws-add` has no cross-pool path and `_pool_ok`
 *     would refuse it, so a name there could only fail after the operator typed it.
 *   * `overflow`: the account is not home-able, an overflow lane the picker still offers for `ccd start`. A workspace
 *     never starts on one (`_is_home_able`), and the server would refuse it as `account-refused`.
 *
 * The `+` door has neither condition: it places the workspace itself.
 */
export const NAME_DOOR_TEXT = {
  crossing: "Named workspaces start in this account's own pool.",
  overflow: "Workspaces don't start on overflow accounts.",
} as const;

export function nameDoorReason(pick: { crossing: boolean; homeAble: boolean }): string | null {
  if (pick.crossing) return NAME_DOOR_TEXT.crossing;
  if (!pick.homeAble) return NAME_DOOR_TEXT.overflow;
  return null;
}
