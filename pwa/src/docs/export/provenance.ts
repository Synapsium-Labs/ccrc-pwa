// Export's provenance (spec 2026-10-01 4.17 "Provenance", "Drafts", "The banner"; native Docs reader W5, Export;
// refinements (a), (f), (s)). What the file says about where it came from, before its content and again as `ccrc:*`
// metas: the project and the repo path; the served ref and how it was chosen; the full commit C the export names; the
// GitHub permalink, or why there is none, by Share's own rule (`shareTargetFor`), so the two never disagree; the source
// (committed, `view=committed`, or a draft with its badge); the time it was exported; on a Markdown export, that it is
// Docs' plain view; and the notes: `onRef` (Share's sentences) and an admitted draft that is not included. A draft's
// banner names the worktree by its closed label, its branch, C, the served ref, the first 12 hex of its fingerprint and
// when it was read. Nothing here reads a document's bytes, a worktree's path (only `closedWorktreeLabel` of it), the main
// checkout's path, a failure's detail or a candidate list (M4.EX5). The builder adds the colouring and image lines once
// it knows what it inlined (`colouringNotes`, `missingNotes`).
//
// Ring L1: pure.
import {
  admitDraft, docRepoPath, entryView, type DocPin, type DocsPageLocation, type DocsShowOk, type DocsTreeOk,
} from '../../../../shared/docs';
import {
  DOCS_HEAD_TEXT, ENTRY_BADGE_TEXT, EXPORT_FACT, EXPORT_PLAIN_SENTENCE, EXPORT_TEXT, VIA_SENTENCE, closedWorktreeLabel,
  fillSentence, pluralS, servedRefText, shareNoteSentence, shareRefusalSentence,
} from '../docsText';
import { shareTargetFor } from '../share';
import type { ExportColouring } from './colouring';
import type { ExportMissing, ExportPlain } from './policy';

type Leaf = DocsPageLocation & { kind: 'path' };

/** One line of the provenance block. */
export interface ExportFact { readonly label: string; readonly value: string }
/** One `<meta name content>`. */
export interface ExportMeta { readonly name: string; readonly content: string }

export interface ProvenanceInput {
  readonly tree: DocsTreeOk;
  readonly page: Leaf;
  /** The pin the leaf opened: its file slot's, or a raster leaf's image's. */
  readonly pin: DocPin;
  /** The file answer the leaf shows; `null`: a raster leaf, which has none. */
  readonly show: DocsShowOk | null;
  readonly exportedAt: number;
  /** When Docs read the bytes: the file slot's `receivedAt` (a raster leaf: the export time). */
  readonly readAt: number;
  /** A `markdown`-class leaf, whatever its body (`exportInputOf` reads the class): the file is Docs' plain view
   *  (refinement (a)). */
  readonly plainView: boolean;
}

export interface ExportProvenance {
  /** C: the opened pin's commit for a committed leaf, the tree's for a draft (refinement (s)). */
  readonly commit: string;
  readonly draft: boolean;
  readonly facts: readonly ExportFact[];
  readonly notes: readonly string[];
  readonly metas: readonly ExportMeta[];
  /** The drafts banner without its images clause, which the builder adds; `null`: not a draft. */
  readonly banner: string | null;
}

const iso = (ms: number): string => new Date(ms).toISOString();

export function exportProvenance(p: ProvenanceInput): ExportProvenance {
  const { tree, page, pin } = p;
  const ref = tree.ref;
  const drafts = tree.drafts;
  const entry = tree.entries.find((e) => e.section === page.section && e.path === page.path);
  const view = entry === undefined ? null : entryView(entry, drafts, page.ref === null ? 'default' : 'ref');
  const badge = view === null || view.badge === null ? DOCS_HEAD_TEXT.sourceDraftUnbadged : ENTRY_BADGE_TEXT[view.badge];
  const label = drafts.state === 'holder' ? closedWorktreeLabel(drafts.worktree) : DOCS_HEAD_TEXT.worktreeOther;
  const commit = pin.kind === 'committed' ? pin.commit : ref.commit;
  const repoPath = docRepoPath(page.section, page.path);
  const via = fillSentence(VIA_SENTENCE[ref.via], ref.requested === null ? {} : { requested: ref.requested });
  const facts: ExportFact[] = [
    { label: EXPORT_FACT.project, value: page.project },
    { label: EXPORT_FACT.path, value: repoPath },
    { label: EXPORT_FACT.served, value: `${servedRefText(ref)} (${via})` },
    { label: EXPORT_FACT.commit, value: commit },
  ];
  const metas: ExportMeta[] = [
    { name: 'ccrc:project', content: page.project },
    { name: 'ccrc:path', content: repoPath },
    { name: 'ccrc:served', content: ref.served },
    { name: 'ccrc:via', content: ref.via },
    { name: 'ccrc:commit', content: commit },
  ];
  const target = shareTargetFor(tree, page, { kind: 'file', pin, show: p.show });
  if (target !== null && target.ok) {
    facts.push({ label: pin.kind === 'draft' ? EXPORT_FACT.committedLink : EXPORT_FACT.link, value: target.url });
    metas.push({ name: 'ccrc:link', content: target.url });
  } else if (target !== null) {
    facts.push({ label: EXPORT_FACT.noLink, value: shareRefusalSentence(target.why, target.fields, false) });
    metas.push({ name: 'ccrc:no-link', content: target.why });
  }
  const source = pin.kind === 'draft' ? fillSentence(DOCS_HEAD_TEXT.sourceDraft, { badge, label })
    : page.view === 'committed' ? DOCS_HEAD_TEXT.sourceViewCommitted : DOCS_HEAD_TEXT.sourceCommitted;
  facts.push({ label: EXPORT_FACT.source, value: source }, { label: EXPORT_FACT.exported, value: iso(p.exportedAt) });
  metas.push(
    { name: 'ccrc:source', content: pin.kind === 'draft' ? 'draft' : page.view === 'committed' ? 'view-committed' : 'committed' },
    { name: 'ccrc:exported', content: iso(p.exportedAt) },
  );
  if (pin.kind === 'draft') metas.push({ name: 'ccrc:worktree', content: label });
  if (p.plainView) {
    facts.push({ label: EXPORT_FACT.view, value: EXPORT_TEXT.plainView });
    metas.push({ name: 'ccrc:view', content: 'plain' });
  }
  const notes: string[] = [];
  for (const line of target?.notes ?? []) {
    if (line.note === 'onRef-not-contained' || line.note === 'onRef-unmeasured') notes.push(shareNoteSentence(line));
  }
  // An admitted draft the leaf does not open (deleted, type changed, withheld), or one `view=committed` set aside: the
  // committed bytes, with the note (spec 4.17's drafts table).
  if (pin.kind === 'committed' && page.ref !== null && entry !== undefined && admitDraft(entry, drafts)) {
    notes.push(fillSentence(EXPORT_TEXT.draftNotIncluded, { badge, label }));
  }
  const banner = pin.kind === 'draft'
    ? fillSentence(EXPORT_TEXT.banner, {
      label, branch: pin.branch, commit, served: ref.served, fp: pin.fp.slice(0, 12), time: iso(p.readAt),
    })
    : null;
  return { commit, draft: pin.kind === 'draft', facts, notes, metas, banner };
}

/** The colouring lines and metas (spec 4.17 "Said in the provenance"): one line per class left plain, in
 *  `EXPORT_PLAIN_SENTENCE`'s order, or the one dropped line; nothing when every block was coloured. */
export function colouringNotes(c: ExportColouring): { readonly notes: readonly string[]; readonly metas: readonly ExportMeta[] } {
  if (c.dropped) return { notes: [EXPORT_TEXT.colouringDropped], metas: [{ name: 'ccrc:colouring', content: 'dropped' }] };
  const notes: string[] = [];
  const metas: ExportMeta[] = [];
  for (const word of Object.keys(EXPORT_PLAIN_SENTENCE) as ExportPlain[]) {
    const k = c.plain.get(word) ?? 0;
    if (k === 0) continue;
    notes.push(fillSentence(EXPORT_TEXT.plainBlocks, { k, s: pluralS(k), sentence: EXPORT_PLAIN_SENTENCE[word] }));
    metas.push({ name: `ccrc:plain-${word}`, content: String(k) });
  }
  return { notes, metas };
}

/** The images-not-included line (one, with the total) and one meta per class. */
export function missingNotes(missing: ReadonlyMap<ExportMissing, number>): { readonly notes: readonly string[]; readonly metas: readonly ExportMeta[] } {
  let k = 0;
  const metas: ExportMeta[] = [];
  for (const [word, n] of missing) {
    if (n === 0) continue;
    k += n;
    metas.push({ name: `ccrc:missing-${word}`, content: String(n) });
  }
  return k === 0 ? { notes: [], metas: [] } : { notes: [fillSentence(EXPORT_TEXT.missing, { k, s: pluralS(k) })], metas };
}
