// The portfolio strip's words and its rank draft (Overlord W1 home B, Task 6; spec §5.6 H38; plan Global Constraints
// "Portfolio"): L1, pure (context C5, the `overlord/**` row). It turns `GET /api/portfolio`'s `PortfolioView` into the strip's rows (each programme in the
// server's rank order, with its class and its fixed date), decides every edit of the operator's draft, and builds the rank
// door's body. No clock, no store, no `lib/api.ts`.
//
// W1 DRAWS NO HEALTH WORD AND NO 85% DATE (Table 4a: W2): no `health`, `forecast` or `calibration` field is read here.
// NOTHING UNMEASURED READS AS A VALUE: a measure with `n: 0` is "no data", never 0; a stored class word this build does not
// know (`rankUnreadable`) is "rank unreadable"; a server with no portfolio (404) says so, and a 503 is unmeasured with its detail.
//
// THE RANK DRAFT. The server orders by class band, then by position inside the band, and an unranked programme sits at the end
// of `standard`. The strip keeps that shape: a row moves up or down inside its band only, and a class change takes the row to the
// end of its new band. The draft remembers which rows the operator touched. `rankWriteOf` writes `order` for every row that is
// ranked (or whose rank is unreadable, so what is saved is what is drawn) or touched, in strip order, and `seen` is EVERY slug
// the strip drew: the server's merge deletes the rank row of any `seen` slug that is not in `order`, and keeps every ranked row
// the console did not list, so a `seen` of only the moved rows would let the merge keep a stale position for a drawn one.
import {
  SERVICE_CLASSES, isCalendarDate, type Measure, type PortfolioEntry, type PortfolioView, type RankWrite, type ServiceClass,
} from '../../../shared/portfolio';
import { LEDGER_ROUTE_REFUSALS } from '../../../shared/refusal';
import type { ReadState } from './readState';
import { spanWords } from './runwayWords';

export const PORTFOLIO_WORDS = {
  title: 'Programmes by priority',
  loading: 'Reading…',
  absent: 'no portfolio on this server',
  unmeasured: 'Portfolio unmeasured',
  empty: 'no programme is listed',
  noData: 'no data',
  rankUnreadable: 'rank unreadable',
  unranked: 'not ranked',
  stale: 'Showing the last portfolio read; the newest read failed.',
  rankMoved: 'The order moved meanwhile, so yours was not saved. This is the new order.',
  needsDate: 'A fixed-date programme needs its date (YYYY-MM-DD) before the order can be saved.',
  save: 'Save order',
  saving: 'Saving…',
  saved: 'Order saved.',
  discard: 'Discard changes',
} as const;

export const CLASS_WORDS: Readonly<Record<ServiceClass, string>> = {
  expedite: 'Expedite', 'fixed-date': 'Fixed date', standard: 'Standard', background: 'Background',
};

export interface StripFact { readonly key: 'wip' | 'cycle'; readonly label: string; readonly text: string }

/** One programme of the strip. `title` is session-written: draw it as text. */
export interface StripRow {
  readonly slug: string;
  readonly title: string;
  readonly cls: ServiceClass;
  /** `YYYY-MM-DD`, on `fixed-date` alone. */
  readonly fixedDate: string | null;
  /** A stored rank row stands for it. */
  readonly ranked: boolean;
  /** A stored row whose class word this build does not know: read as unranked, and said so. */
  readonly rankUnreadable: boolean;
  readonly facts: readonly StripFact[];
}

/** A duration series as words: no sample is "no data", never 0. Waves counted in the window beside it that could not be
 *  measured are said too. */
export function cycleText(cycle: Measure, unmeasured: number): string {
  const rest = unmeasured > 0 ? ` (${unmeasured} not measured)` : '';
  if (cycle.n === 0 || cycle.medianMs === null) return `${PORTFOLIO_WORDS.noData}${rest}`;
  return `median ${spanWords(cycle.medianMs)} over ${cycle.n} ${cycle.n === 1 ? 'wave' : 'waves'}${rest}`;
}

export function rowOf(e: PortfolioEntry): StripRow {
  return {
    slug: e.slug,
    title: e.title === '' ? e.slug : e.title,
    cls: e.cls,
    fixedDate: e.rank === null ? null : e.rank.fixedDate,
    ranked: e.rank !== null,
    rankUnreadable: e.rankUnreadable === true,
    facts: [
      { key: 'wip', label: 'Waves', text: `${e.wip.working} working, ${e.wip.waiting} waiting, ${e.wip.queued} queued` },
      { key: 'cycle', label: 'Wave time', text: cycleText(e.cycle, e.cycleUnmeasured) },
    ],
  };
}

export type StripView =
  | { readonly kind: 'loading' }
  | { readonly kind: 'absent'; readonly text: string }
  | { readonly kind: 'unmeasured'; readonly text: string }
  | { readonly kind: 'rows'; readonly revision: number; readonly rows: readonly StripRow[]; readonly stale: string | null };

/** What the strip draws for a read. A stale read keeps its rows and says so. */
export function stripView(read: ReadState<PortfolioView>): StripView {
  if (read.state === 'loading') return { kind: 'loading' };
  if (read.state === 'absent') return { kind: 'absent', text: PORTFOLIO_WORDS.absent };
  if (read.state === 'unmeasured') return { kind: 'unmeasured', text: `${PORTFOLIO_WORDS.unmeasured} (${read.error})` };
  return {
    kind: 'rows', revision: read.value.revision, rows: read.value.programmes.map(rowOf),
    stale: read.state === 'stale' ? PORTFOLIO_WORDS.stale : null,
  };
}

export interface StripDraft { readonly rows: readonly StripRow[]; readonly touched: readonly string[] }

export const draftOf = (rows: readonly StripRow[]): StripDraft => ({ rows, touched: [] });
export const isDirty = (d: StripDraft): boolean => d.touched.length > 0;

const bandOf = (cls: ServiceClass): number => SERVICE_CLASSES.indexOf(cls);
const touch = (touched: readonly string[], ...slugs: string[]): readonly string[] => [...new Set([...touched, ...slugs])];

/** Whether a row can move one place in `dir`: inside its own band, so the strip keeps the server's class bands. */
export function canMove(d: StripDraft, slug: string, dir: -1 | 1): boolean {
  const i = d.rows.findIndex((r) => r.slug === slug);
  const next = d.rows[i + dir];
  return i >= 0 && next !== undefined && next.cls === d.rows[i]!.cls;
}

/** Swap a row with its neighbour in `dir`, inside the band. Both rows are touched: their relative order is now the operator's. */
export function moveRow(d: StripDraft, slug: string, dir: -1 | 1): StripDraft {
  if (!canMove(d, slug, dir)) return d;
  const i = d.rows.findIndex((r) => r.slug === slug);
  const rows = [...d.rows];
  [rows[i], rows[i + dir]] = [rows[i + dir]!, rows[i]!];
  return { rows, touched: touch(d.touched, slug, d.rows[i + dir]!.slug) };
}

/** Put a row in a class: it takes the end of that class's band. `fixed-date` keeps a date the row had; any other class has none. */
export function setClass(d: StripDraft, slug: string, cls: ServiceClass): StripDraft {
  const row = d.rows.find((r) => r.slug === slug);
  if (row === undefined || row.cls === cls) return d;
  const moved: StripRow = { ...row, cls, fixedDate: cls === 'fixed-date' ? row.fixedDate : null };
  const rest = d.rows.filter((r) => r.slug !== slug);
  const after = rest.findIndex((r) => bandOf(r.cls) > bandOf(cls));
  const at = after === -1 ? rest.length : after;
  return { rows: [...rest.slice(0, at), moved, ...rest.slice(at)], touched: touch(d.touched, slug) };
}

/** Set a `fixed-date` row's date, as typed (a `YYYY-MM-DD` the server will check as a calendar date). */
export function setFixedDate(d: StripDraft, slug: string, date: string): StripDraft {
  const row = d.rows.find((r) => r.slug === slug);
  if (row === undefined || row.cls !== 'fixed-date') return d;
  return { rows: d.rows.map((r) => (r.slug === slug ? { ...r, fixedDate: date === '' ? null : date } : r)), touched: touch(d.touched, slug) };
}

/** Whether a refusal word is the rank door's `rank-changed`: the order moved in another tab since this strip read it. The strip
 *  then reads again and shows the new order; it never sends the same order a second time. */
export const isRankChanged = (word: unknown): boolean => word === LEDGER_ROUTE_REFUSALS.rankChanged;

export type RankWriteAnswer =
  | { readonly ok: true; readonly write: RankWrite }
  | { readonly ok: false; readonly why: 'needs-date'; readonly slug: string };

/** The rank door's body for a draft read at `basedOn`: `seen` is every slug the strip drew; `order` the new order of the rows
 *  that are ranked or touched. A `fixed-date` row with no calendar date is not written (the door would refuse the whole body). */
export function rankWriteOf(basedOn: number, d: StripDraft): RankWriteAnswer {
  const listed = d.rows.filter((r) => r.ranked || r.rankUnreadable || d.touched.includes(r.slug));
  const undated = listed.find((r) => r.cls === 'fixed-date' && !isCalendarDate(r.fixedDate));
  if (undated !== undefined) return { ok: false, why: 'needs-date', slug: undated.slug };
  return {
    ok: true,
    write: {
      basedOn,
      seen: d.rows.map((r) => r.slug),
      order: listed.map((r) => ({ slug: r.slug, cls: r.cls, fixedDate: r.cls === 'fixed-date' ? r.fixedDate : null })),
    },
  };
}
