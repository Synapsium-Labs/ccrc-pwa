/**
 * THE ANCHOR'S RENDERER (Overlord design spec §3.3.3, C38; §3.3.5, C40; plan `w1a-anchor.md` Task 1).
 *
 * The card arrives in two parts: the card a session reads itself (`card.ts`), and this short anchor, which the session hook
 * prints in its first slot at a start, and once on the next prompt after an automatic compaction that brought no start.
 * One set of facts, two parts: the anchor reads the same `CardFacts` the card is drawn from, and names the card's hash, so a
 * session can tell the card it reads is the one its anchor named.
 *
 * ITS CONTENT, IN ORDER (C38): the role line; the canaries on one line (term, generation, card hash; the rules version
 * joins with W1's grants, slug rules-version-in-w1); the counts on one line (runs, open items and asks, outstanding mail,
 * notes); and the one instruction, to read the card. Every line is a statement of fact but the instruction. The `prompt`
 * form carries the canaries and the instruction only.
 *
 * THE CANARIES SURVIVE A CUT. The text fits its ceiling here, in UTF-8 bytes (`ANCHOR_CARD_MAX_CHARS`,
 * `ANCHOR_PROMPT_MAX_CHARS`): only the role line is ever shortened, and it is shortened first, so the canaries, the counts
 * and the instruction always print whole. The hook's own clip at the same number cuts from the end and so never meets a
 * text from here.
 *
 * THE NULL RULE. A fact that could not be read renders as `unmeasured`, never as zero and never as an empty anchor.
 *
 * MASKED BEFORE IT IS FITTED. The role line is the one part a row's text reaches (a programme slug, the role's reason), and
 * it is passed through `mask`, the caller's one card masker, before it is measured, so a masker that lengthens a line can
 * never push the anchor past its ceiling. The other lines are numbers, fixed words and the hash's hex.
 *
 * L1, pure: no `fs`, no store, no clock; `mask` is the caller's pure text function.
 */
import {
  ANCHOR_CARD_MAX_CHARS, ANCHOR_PROMPT_MAX_CHARS, type AnchorGeneration, type CardFacts, type CardItem, type Fact,
} from '../../../shared/continuity-card.js';
import { utf8Bytes } from '../../../shared/utf8.js';
import { oneLine } from './card.js';

/** The forms `renderAnchor` draws (the `fork` form has no text: the hook prints its own line). */
export type AnchorTextForm = 'start' | 'prompt';

/** Every anchor line begins with this, so the hook's context, and a reader, can tell the slot's text from the others. */
export const ANCHOR_PREFIX = 'ccrc-anchor:';
/** The one instruction (C38), the anchor's last line. */
export const ANCHOR_INSTRUCTION = "Your card is the server's record of what stands. Read it now with `ccrc-api card`, before anything else.";
/** The canary's card hash is this many hex characters of the card's sha256. */
export const ANCHOR_HASH_CHARS = 12;
/** What an unread fact reads as on the anchor. */
export const ANCHOR_UNMEASURED = 'unmeasured';
/** The mark a shortened role line ends with. */
const CUT = '…';

/** The ceiling of each form, in UTF-8 bytes. */
export const ANCHOR_CEILING: Readonly<Record<AnchorTextForm, number>> = {
  start: ANCHOR_CARD_MAX_CHARS, prompt: ANCHOR_PROMPT_MAX_CHARS,
};

/** What the anchor reads beside the card's facts: the card's hash (the masked, trimmed card's sha256, as the card door
 *  computes it) and the identity's generation. */
export interface AnchorInput {
  readonly cardHash: string;
  readonly generation: AnchorGeneration;
}

/** The role line: the role, the programmes of the runs it claims or serves when they were read, and the role's reason
 *  while the role is undecided. */
function roleLine(f: CardFacts): string {
  if (f.role === 'undecided') return `role: undecided (${oneLine(f.roleWhy)})`;
  if (f.runs.kind === 'unmeasured') return `role: ${oneLine(f.role)} (its runs: ${ANCHOR_UNMEASURED})`;
  const programmes = [...new Set(f.runs.value.map((r) => oneLine(r.programme)))].sort();
  return programmes.length === 0 ? `role: ${oneLine(f.role)}` : `role: ${oneLine(f.role)} of ${programmes.join(', ')}`;
}

/** The canaries: term, generation (`n`, or `n+1 starting` while the session's newest start is not yet minted) and the
 *  card hash. */
function canaryLine(a: AnchorInput): string {
  const g = a.generation;
  const term = g.kind === 'live' ? String(g.term) : g.kind === 'none' ? 'none' : ANCHOR_UNMEASURED;
  const gen = g.kind === 'live' ? (g.starting ? `${g.n + 1} starting` : String(g.n)) : g.kind === 'none' ? 'none' : ANCHOR_UNMEASURED;
  return `term ${term} · generation ${gen} · card ${a.cardHash.slice(0, ANCHOR_HASH_CHARS)}`;
}

const count = <T>(fact: Fact<readonly T[]>, what: string): string =>
  fact.kind === 'unmeasured' ? `${what} ${ANCHOR_UNMEASURED}` : `${fact.value.length} ${what}`;

/** The open items and asks the card lists: every open item of the session's programmes and every item it raised, once
 *  each, or `unmeasured` when either source could not be read. */
function itemsCount(f: CardFacts): string {
  const what = 'open items and asks';
  if (f.ledger.kind === 'unmeasured' || f.itemsRaised.kind === 'unmeasured') return `${what} ${ANCHOR_UNMEASURED}`;
  const ids = new Set<number>();
  for (const p of f.ledger.value) for (const it of p.openItems) ids.add(it.id);
  for (const it of f.itemsRaised.value as readonly CardItem[]) ids.add(it.id);
  return `${ids.size} ${what}`;
}

/** The counts: runs, open items and asks, outstanding mail (`more than N` when the card read its cap), notes. */
function countsLine(f: CardFacts): string {
  const mail = f.mailOutstanding.kind === 'read' && f.mailMore ? `more than ${f.mailOutstanding.value.length} outstanding mail`
    : count(f.mailOutstanding, 'outstanding mail');
  return `counts: ${[count(f.runs, 'runs'), itemsCount(f), mail, count(f.notes, 'notes')].join(' · ')}`;
}

/** `text` cut to at most `maxBytes` UTF-8 bytes on a code point, ending in the cut mark when anything was cut. */
function fitBytes(text: string, maxBytes: number): string {
  if (utf8Bytes(text) <= maxBytes) return text;
  const room = maxBytes - utf8Bytes(CUT);
  let out = '';
  let used = 0;
  for (const ch of text) {
    const b = utf8Bytes(ch);
    if (used + b > room) break;
    out += ch;
    used += b;
  }
  return out + CUT;
}

/** The anchor's text for one form, at most its ceiling in UTF-8 bytes (`ANCHOR_CEILING`). The fixed lines are never cut
 *  (about 260 bytes at their longest, so the role line always has room); the role line, masked first, takes what is left. */
export function renderAnchor(f: CardFacts, a: AnchorInput, form: AnchorTextForm, mask: (text: string) => string = (t) => t): string {
  const tail = form === 'start' ? [canaryLine(a), countsLine(f), ANCHOR_INSTRUCTION] : [canaryLine(a), ANCHOR_INSTRUCTION];
  const fixed = tail.join('\n');
  // The prompt form is bounded by construction (two safe integers, twelve hex characters, fixed words), never cut: its
  // worst case is pinned under `ANCHOR_PROMPT_MAX_CHARS` by a test, and it carries no row's text, so nothing reaches `mask`.
  if (form === 'prompt') return `${ANCHOR_PREFIX} ${fixed}`;
  const head = `${ANCHOR_PREFIX} `;
  const room = ANCHOR_CEILING.start - utf8Bytes(head) - utf8Bytes(fixed) - 1;
  const role = fitBytes(mask(roleLine(f)), room);
  return `${head}${role}\n${fixed}`;
}
