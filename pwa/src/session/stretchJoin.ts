// A tool stretch across an older page's join (desktop polish wave 175, fix round 1 F2).
//
// A stretch is keyed by its first entry (`activity-<first entry's key>`, `toolActivity.ts`). An older page whose newest
// rows are calls joins the stretch at the top of the list: the stretch takes them at its start, so its key changes, and
// when the page is only calls no other row is added. It is the same stretch, grown at its top. So the list reads the join
// off the two lists, never off the key's spelling: which stretch each vanished key became (`renamedAcross`), so the
// reader's open stretch stays open (`keepOpenAcross`) and the hold keeps the reader's place by the stretch's foot, which a
// growth at its top does not move (`ChatList.tsx`, the hold).
//
// L1: pure, no I/O, no React.

/** A list row as the join reads it: its key, and a stretch's entries. */
export interface JoinRow {
  readonly kind: string;
  readonly key: string;
  readonly entries?: readonly { readonly key: string }[];
}

/** The reader's open or closed choice per stretch, by its key (`transcriptRow.tsx#ExpansionMemo`). */
export interface OpenMemo {
  get(key: string): boolean;
  set(key: string, open: boolean): void;
}

const isStretch = (r: JoinRow): boolean => r.kind === 'tool-activity' && (r.entries?.length ?? 0) > 0;

/** Each stretch of `was` whose key `now` no longer has, mapped to the stretch of `now` that holds its first entry: the
 *  same stretch, renamed by entries joined at its start. A key `now` still has, or a stretch whose entries went, is not
 *  in it. */
export function renamedAcross(was: readonly JoinRow[], now: readonly JoinRow[]): Map<string, string> {
  const out = new Map<string, string>();
  const keys = new Set(now.map((r) => r.key));
  const gone = new Map<string, string>();
  for (const r of was) if (isStretch(r) && !keys.has(r.key)) gone.set(r.entries![0]!.key, r.key);
  if (gone.size === 0) return out;
  for (const r of now) {
    if (!isStretch(r)) continue;
    for (const e of r.entries!) {
      const from = gone.get(e.key);
      if (from !== undefined && !out.has(from)) out.set(from, r.key);
    }
  }
  return out;
}

/** The open state follows a stretch across a rename: the stretch it became opens when the reader had it open. A stretch
 *  the reader had closed stays closed (closed is every row's default). */
export function keepOpenAcross(was: readonly JoinRow[], now: readonly JoinRow[], memo: OpenMemo): void {
  for (const [from, to] of renamedAcross(was, now)) if (memo.get(from) && !memo.get(to)) memo.set(to, true);
}
