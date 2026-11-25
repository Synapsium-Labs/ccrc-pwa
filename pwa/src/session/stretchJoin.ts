// A tool stretch across an older page's join (desktop polish wave 175, fix round 1 F2).
//
// A stretch is keyed by its first entry (`activity-<first entry's key>`, `toolActivity.ts`). An older page whose newest
// rows are calls joins the stretch at the top of the list: the stretch takes them at its start, so its key changes, and
// when the page is only calls no other row is added. It is the same stretch, grown at its top. So the list reads the join
// off the two lists, never off the key's spelling: which stretch each vanished key became (`renamedAcross`), so the
// reader's open stretch stays open (`keepOpenAcross`) and the hold keeps the reader's place by the stretch's foot, which a
// growth at its top does not move (`ChatList.tsx`, the hold).
//
// A RUN OF MAIL PROMPTS JOINS THE SAME WAY (wave 176's fold, absorbed in fix round 2). A run is keyed by its first prompt
// (`mail-prompts-<first prompt's key>`, `mailRows.ts#foldMailRows`), so an older page whose newest rows are prompts of the
// same day joins the run at the top of the list and renames it, and a lone prompt there becomes a run. The same reading
// serves: a run's members are its prompts, and a lone prompt is its own one member. A fetched mail card standing alone at
// the top is taken into a stretch the same way (`toolActivity.ts#joinsStretch`): the hold follows it to the stretch's
// foot, and its open state stays its own (a card's choice is keyed by the card, which a join does not change).
//
// L1: pure, no I/O, no React.

/** A list row as the join reads it: its key, a stretch's entries, a run's members (its prompts and the dividers between). */
export interface JoinRow {
  readonly kind: string;
  readonly key: string;
  readonly entries?: readonly { readonly key: string }[];
  readonly mail?: readonly { readonly key: string }[];
  readonly members?: readonly { readonly kind: string; readonly key: string }[];
}

/** The reader's open or closed choice per stretch, by its key (`transcriptRow.tsx#ExpansionMemo`). */
export interface OpenMemo {
  get(key: string): boolean;
  set(key: string, open: boolean): void;
}

/** The keys a row is made of, first member first, when another row can take it in at a join: a stretch's tool entries
 *  and then its cards, a run's prompts, a lone prompt or a lone card itself. Empty for every other row. */
function membersOf(r: JoinRow): string[] {
  if (r.kind === 'tool-activity') return [...(r.entries ?? []), ...(r.mail ?? [])].map((e) => e.key);
  if (r.kind === 'mail-prompts') return (r.members ?? []).filter((m) => m.kind === 'mail-prompt').map((m) => m.key);
  if (r.kind === 'mail-prompt' || r.kind === 'mail') return [r.key];
  return [];
}

/** The group a row's open state belongs to across a join: a stretch stays a stretch, a prompt becomes or stays a run.
 *  A card taken into a stretch is neither: its choice is the card's own. */
const groupOf = (kind: string | undefined): string | null =>
  kind === 'tool-activity' ? 'stretch' : kind === 'mail-prompt' || kind === 'mail-prompts' ? 'prompts' : null;

/** Each joinable row of `was` (a stretch, a run of prompts, a lone prompt) whose key `now` no longer has, mapped to the
 *  row of `now` of the same kind of group that holds its first member: the same stretch or run, renamed by members joined
 *  at its start. A key `now` still has, or a row whose members went, is not in it. */
export function renamedAcross(was: readonly JoinRow[], now: readonly JoinRow[]): Map<string, string> {
  const out = new Map<string, string>();
  const keys = new Set(now.map((r) => r.key));
  const gone = new Map<string, string>();
  for (const r of was) {
    const first = membersOf(r)[0];
    if (first !== undefined && !keys.has(r.key)) gone.set(first, r.key);
  }
  if (gone.size === 0) return out;
  for (const r of now) {
    for (const m of membersOf(r)) {
      const from = gone.get(m);
      if (from !== undefined && !out.has(from)) out.set(from, r.key);
    }
  }
  return out;
}

/** The open state follows a stretch or a run of prompts across a rename: the row it became opens when the reader had it
 *  open. One the reader had closed stays closed (closed is every such row's default). */
export function keepOpenAcross(was: readonly JoinRow[], now: readonly JoinRow[], memo: OpenMemo): void {
  const kindIn = (rows: readonly JoinRow[], key: string): string | undefined => rows.find((r) => r.key === key)?.kind;
  for (const [from, to] of renamedAcross(was, now)) {
    const group = groupOf(kindIn(was, from));
    if (group === null || group !== groupOf(kindIn(now, to))) continue;
    if (memo.get(from) && !memo.get(to)) memo.set(to, true);
  }
}
