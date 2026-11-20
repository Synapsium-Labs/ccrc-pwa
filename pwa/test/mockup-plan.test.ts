// Native Docs reader, completion plan Task 6 (C1): the mockup asset planner (`plan.ts`; base spec 2026-10-01 5.6.3's Pins,
// verdict union and Budgets, as amended by D-8659). The planner is pure: every case builds a plain tree and a captured
// context and reads rows back. Placeholders only (`demo`, `main`, `https://a.example`).
import { describe, expect, it, vi } from 'vitest';
import { DOCS_CLASS_CAP, type DocPin, type DocsEntry, type DocsTreeOk } from '../../shared/docs';
import { MOCKUP_MAX_ASSET_BYTES, MOCKUP_MAX_ASSETS } from '../src/docs/mockup/policy';
import {
  MockupContextMismatch, extendMockupAssetPlan, mockupPage, mockupSizeBasis, planMockupAssets,
} from '../src/docs/mockup/plan';
import type { MockupAssetPlan, MockupContext, MockupRef, MockupRefVerdict } from '../src/docs/mockup/ports';
import { pinFor } from '../src/docs/useDocsVisit';
import { COMMIT_A, COMMIT_B, FP_1, SERVED, draftOf, entry, holder, treeOk } from './docsFixtures';

const FP_2 = 'e'.repeat(64);
const MIB = 1024 * 1024;
const PAGE = 'm.html';
const PAGE_BASE = 'specs/m.html' as const;
const CSS_BASE = 'specs/s.css' as const;

let counter = 0;
/** One reference as discovered; a fresh unique key each. */
function ref(raw: string, over: Partial<MockupRef> = {}): MockupRef {
  counter += 1;
  return { key: `k${counter}`, raw, basePath: PAGE_BASE, kind: 'image', depth: 0, ...over };
}
/** A reference found in the stylesheet `specs/s.css` at depth 1. */
const cssRef = (raw: string, over: Partial<MockupRef> = {}): MockupRef => ref(raw, { basePath: CSS_BASE, depth: 1, ...over });

const png = (path: string, size: number, over: Partial<DocsEntry> = {}): DocsEntry =>
  entry('specs', path, { committed: { kind: 'file', blob: '1'.repeat(40), size }, ...over });

const committedAt = (commit: string): DocPin =>
  ({ kind: 'committed', commit, servedRef: SERVED, section: 'specs', path: PAGE });
const draftPin: DocPin = { kind: 'draft', branch: 'main', head: COMMIT_A, section: 'specs', path: PAGE, fp: FP_1 };

/** A committed page's context: the page `specs/m.html` and `assets`, the listing at COMMIT_A; `pinCommit` names a
 *  historical page commit. */
function committedCtx(assets: DocsEntry[], o: { pinCommit?: string; drafts?: DocsTreeOk['drafts'] } = {}): MockupContext {
  const tree = treeOk({ entries: [entry('specs', PAGE), ...assets], drafts: o.drafts ?? holder() });
  return { project: 'demo', pin: committedAt(o.pinCommit ?? COMMIT_A), tree };
}

/** A draft page's context: the page carries a modified draft, the holder is at the served commit. */
function draftCtx(assets: DocsEntry[]): MockupContext {
  const tree = treeOk({ entries: [entry('specs', PAGE, { draft: draftOf('modified') }), ...assets], drafts: holder() });
  return { project: 'demo', pin: draftPin, tree };
}

const verdicts = (p: MockupAssetPlan): MockupRefVerdict[] => p.rows.map((r) => r.verdict);
const kinds = (p: MockupAssetPlan): string[] => p.rows.map((r) => r.verdict.v);
const committedAsset = (path: string, commit = COMMIT_A): DocPin =>
  ({ kind: 'committed', commit, servedRef: SERVED, section: 'specs', path });
const draftAsset = (path: string, fp = FP_1): DocPin =>
  ({ kind: 'draft', branch: 'main', head: COMMIT_A, section: 'specs', path, fp });

/** `n` distinct small PNG entries `p0.png`..`p<n-1>.png`, and their refs. */
const many = (n: number, size = 10, prefix = 'p'): { entries: DocsEntry[]; names: string[] } => {
  const names = Array.from({ length: n }, (_, i) => `${prefix}${i}.png`);
  return { entries: names.map((nm) => png(nm, size)), names };
};

describe('mockupPage: the page location the pin rule reads (plan Task 6)', () => {
  it('a committed page at the listing\'s commit is the default view of the page, and pinFor answers the context pin', () => {
    const ctx = committedCtx([]);
    const page = mockupPage(ctx);
    expect(page).toMatchObject({ kind: 'path', section: 'specs', path: PAGE, ref: null, at: null, view: 'effective', frame: 'inline', dirSlash: false });
    expect(pinFor(ctx.tree, page)).toEqual(ctx.pin);
  });

  it('a historical committed page is the version page at its commit, and pinFor answers the context pin', () => {
    const ctx = committedCtx([], { pinCommit: COMMIT_B });
    const page = mockupPage(ctx);
    expect(page.at).toBe(COMMIT_B);
    expect(pinFor(ctx.tree, page)).toEqual(ctx.pin);
  });

  it('a draft page is a ref view of its branch, and pinFor answers the context pin', () => {
    const ctx = draftCtx([]);
    const page = mockupPage(ctx);
    expect(page).toMatchObject({ ref: { kind: 'bare', name: 'main' }, at: null, view: 'effective' });
    expect(pinFor(ctx.tree, page)).toEqual(ctx.pin);
  });

  it('a draft context whose tree no longer opens that draft throws MockupContextMismatch', () => {
    const tree = treeOk({ entries: [entry('specs', PAGE)], drafts: holder() });
    expect(() => mockupPage({ project: 'demo', pin: draftPin, tree })).toThrow(MockupContextMismatch);
    const moved = draftCtx([]);
    const other: MockupContext = { ...moved, pin: { ...draftPin, fp: FP_2 } };
    expect(() => mockupPage(other)).toThrow(MockupContextMismatch);
  });

  it('a committed context whose page the listing does not hold throws MockupContextMismatch', () => {
    const tree = treeOk({ entries: [] });
    expect(() => mockupPage({ project: 'demo', pin: committedAt(COMMIT_A), tree })).toThrow(MockupContextMismatch);
  });
});

describe('mockupSizeBasis: the one size basis (D-8659)', () => {
  const tree = treeOk();
  it('a committed pin at the listing\'s commit with a numeric size is listed', () => {
    expect(mockupSizeBasis(png('i.png', 700), tree, committedAsset('i.png'), 'raster')).toEqual({ kind: 'listed', bytes: 700 });
  });
  it('a committed pin at another commit is the class cap, whatever the tip lists', () => {
    expect(mockupSizeBasis(png('i.png', 700), tree, committedAsset('i.png', COMMIT_B), 'raster'))
      .toEqual({ kind: 'class-cap', bytes: DOCS_CLASS_CAP.raster });
  });
  it('an unknown listed size is the class cap', () => {
    const e = entry('specs', 'i.png', { committed: { kind: 'file', blob: '1'.repeat(40), size: null } });
    expect(mockupSizeBasis(e, tree, committedAsset('i.png'), 'raster')).toEqual({ kind: 'class-cap', bytes: DOCS_CLASS_CAP.raster });
    expect(mockupSizeBasis(undefined, tree, committedAsset('i.png'), 'svg')).toEqual({ kind: 'class-cap', bytes: DOCS_CLASS_CAP.svg });
  });
  it('a draft pin at the listed fingerprint uses the draft size; another fingerprint is the class cap', () => {
    const e = png('i.png', 5, { draft: draftOf('modified', { size: 321 }) });
    expect(mockupSizeBasis(e, tree, draftAsset('i.png'), 'raster')).toEqual({ kind: 'listed', bytes: 321 });
    expect(mockupSizeBasis(e, tree, draftAsset('i.png', FP_2), 'raster')).toEqual({ kind: 'class-cap', bytes: DOCS_CLASS_CAP.raster });
  });
});

describe('planMockupAssets: the pin rule (plan Task 6 RED table)', () => {
  it('a committed page reads C for an asset that has a modified draft: CommittedPin, no draft', () => {
    const ctx = committedCtx([png('i.png', 100, { draft: draftOf('modified', { fp: FP_2 }) })]);
    const p = planMockupAssets([ref('i.png')], ctx);
    expect(p.rows[0]!.verdict).toEqual({ v: 'inline', pin: committedAsset('i.png'), kind: 'image', mime: 'image/png', size: 100, draft: false });
    expect(p.rows[0]!.size).toEqual({ kind: 'listed', bytes: 100 });
  });

  for (const state of ['modified', 'conflicted'] as const) {
    it(`an admitted draft ${state} gets a DraftPin with draft true, sized by the draft's own listing`, () => {
      const ctx = draftCtx([png('i.png', 100, { draft: draftOf(state, { fp: FP_2, size: 222 }) })]);
      const p = planMockupAssets([ref('i.png')], ctx);
      expect(p.rows[0]!.verdict).toEqual({ v: 'inline', pin: draftAsset('i.png', FP_2), kind: 'image', mime: 'image/png', size: 222, draft: true });
      expect(p.rows[0]!.size).toEqual({ kind: 'listed', bytes: 222 });
    });
  }

  for (const state of ['added', 'untracked'] as const) {
    it(`an admitted draft ${state} (no committed side) gets a DraftPin`, () => {
      const ctx = draftCtx([entry('specs', 'i.png', { committed: null, draft: draftOf(state, { fp: FP_2 }) })]);
      const p = planMockupAssets([ref('i.png')], ctx);
      expect(p.rows[0]!.verdict).toMatchObject({ v: 'inline', pin: draftAsset('i.png', FP_2), draft: true });
    });
  }

  it('a draft page whose asset the worktree deleted is missing:deleted-in-worktree, with no committed fallback', () => {
    const ctx = draftCtx([png('i.png', 100, { draft: draftOf('deleted', { kind: 'absent', fp: null, size: null }) })]);
    const p = planMockupAssets([ref('i.png')], ctx);
    expect(p.rows[0]).toEqual({ ref: p.rows[0]!.ref, verdict: { v: 'missing', why: 'deleted-in-worktree' }, size: null });
    expect(p.reservedBytes).toBe(0);
  });

  it('a draft page whose asset draft is withheld (no fingerprint) is missing:draft-withheld, with no committed fallback', () => {
    const ctx = draftCtx([png('i.png', 100, { draft: draftOf('modified', { fp: null }) })]);
    const p = planMockupAssets([ref('i.png')], ctx);
    expect(p.rows[0]!.verdict).toEqual({ v: 'missing', why: 'draft-withheld' });
    expect(p.rows[0]!.size).toBeNull();
  });

  it('a draft page whose asset is stat-pinned (read by range) is missing:draft-unhashed, as the Markdown image is (X2 P1, review F5)', () => {
    const ctx = draftCtx([png('i.png', 100, { draft: draftOf('modified', { fp: null, size: 5242880, mtimeNs: '1700000000000000000' }) })]);
    const p = planMockupAssets([ref('i.png')], ctx);
    expect(p.rows[0]!.verdict).toEqual({ v: 'missing', why: 'draft-unhashed' });
    expect(p.rows[0]!.size).toBeNull();
  });

  it('a draft page whose asset changed type is missing:draft-withheld, with no committed fallback', () => {
    const ctx = draftCtx([png('i.png', 100, { draft: draftOf('typechange', { kind: 'symlink', fp: null }) })]);
    expect(planMockupAssets([ref('i.png')], ctx).rows[0]!.verdict).toEqual({ v: 'missing', why: 'draft-withheld' });
  });

  it('an asset the listing does not hold, or holds as a symlink, is missing:absent-at-commit', () => {
    const link = entry('specs', 'l.png', { committed: { kind: 'symlink', blob: '1'.repeat(40), size: 10 } });
    const p = planMockupAssets([ref('nope.png'), ref('l.png')], committedCtx([link]));
    expect(verdicts(p)).toEqual([{ v: 'missing', why: 'absent-at-commit' }, { v: 'missing', why: 'absent-at-commit' }]);
    expect(p.rows.map((r) => r.size)).toEqual([null, null]);
  });

  it('a historical page reads its assets at its own commit and shows no draft', () => {
    const ctx = committedCtx([png('i.png', 100, { draft: draftOf('modified') })], { pinCommit: COMMIT_B });
    const row = planMockupAssets([ref('i.png')], ctx).rows[0]!;
    expect(row.verdict).toMatchObject({ v: 'inline', pin: committedAsset('i.png', COMMIT_B), draft: false });
  });
});

describe('planMockupAssets: references, kinds and depth', () => {
  const ctx = committedCtx([png('i.png', 10), entry('specs', 's.css'), entry('specs', 'x.js'), entry('specs', 'x.bin')]);

  it('CSS depth 3 is admitted and depth 4 is unsupported:css-depth', () => {
    const p = planMockupAssets([
      ref('s.css', { kind: 'css', depth: 3 }), ref('s.css', { kind: 'css', depth: 4 }), ref('i.png', { depth: 4 }),
    ], ctx);
    expect(kinds(p)).toEqual(['inline', 'unsupported', 'unsupported']);
    expect(p.rows[1]!.verdict).toEqual({ v: 'unsupported', why: 'css-depth' });
    expect(p.rows[2]!.verdict).toEqual({ v: 'unsupported', why: 'css-depth' });
    expect(p.rows[1]!.size).toBeNull();
  });

  it('an unknown extension and a kind its extension does not fit are unsupported:kind', () => {
    const p = planMockupAssets([
      ref('x.bin'), ref('s.css', { kind: 'image' }), ref('i.png', { kind: 'script' }), ref('x.js', { kind: 'module' }),
    ], ctx);
    expect(verdicts(p)).toEqual([
      { v: 'unsupported', why: 'kind' }, { v: 'unsupported', why: 'kind' }, { v: 'unsupported', why: 'kind' },
      expect.objectContaining({ v: 'inline', mime: 'text/javascript', kind: 'module' }),
    ]);
  });

  it('every resolveDocRef arm keeps its own verdict', () => {
    const p = planMockupAssets([
      ref('#top'), ref('data:image/png;base64,AAAA'), ref('https://a.example/x.png'), ref('mailto:x@a.example'),
      ref('../../../x.png'), ref('/abs.png'), ref('//a.example/x.png'), ref('../../../../x.png'), ref(''),
    ], ctx);
    expect(verdicts(p)).toEqual([
      { v: 'kept', why: 'fragment' },
      { v: 'kept', why: 'self-contained' },
      { v: 'external', origin: 'https://a.example', via: 'src' },
      { v: 'refused', why: 'scheme' },
      { v: 'refused', why: 'repo' },
      { v: 'refused', why: 'root-relative' },
      { v: 'refused', why: 'protocol-relative' },
      { v: 'refused', why: 'above-root' },
      { v: 'refused', why: 'empty' },
    ]);
    expect(p.rows.every((r) => r.size === null)).toBe(true);
    expect(p.reservedBytes).toBe(0);
  });

  it('a relative reference resolves from its own base: a stylesheet\'s reference is read from the stylesheet', () => {
    const nested = committedCtx([entry('specs', 'img/bg.png')]);
    const p = planMockupAssets([ref('img/bg.png'), cssRef('img/bg.png'), cssRef('bg.png')], nested);
    expect(kinds(p)).toEqual(['inline', 'inline', 'missing']);
  });
});

describe('planMockupAssets: budgets (base 5.6.3, inclusive; reserved before any fetch)', () => {
  it('exactly 64 distinct assets are admitted and the 65th is skipped:over-budget with no reservation', () => {
    const { entries, names } = many(MOCKUP_MAX_ASSETS + 1);
    const p = planMockupAssets(names.map((n) => ref(n)), committedCtx(entries));
    expect(kinds(p).slice(0, MOCKUP_MAX_ASSETS).every((k) => k === 'inline')).toBe(true);
    expect(p.rows[MOCKUP_MAX_ASSETS]!.verdict).toEqual({ v: 'skipped', why: 'over-budget' });
    expect(p.rows[MOCKUP_MAX_ASSETS]!.size).toBeNull();
    expect(p.reservedBytes).toBe(MOCKUP_MAX_ASSETS * 10);
  });

  it('exactly 5 MiB is admitted and the asset past it is skipped:over-budget', () => {
    const entries = [png('a.png', 2 * MIB), png('b.png', 2 * MIB), png('c.png', MIB), png('d.png', 1)];
    const p = planMockupAssets(['a.png', 'b.png', 'c.png', 'd.png'].map((n) => ref(n)), committedCtx(entries));
    expect(kinds(p)).toEqual(['inline', 'inline', 'inline', 'skipped']);
    expect(p.reservedBytes).toBe(MOCKUP_MAX_ASSET_BYTES);
    expect(p.rows[3]!.verdict).toEqual({ v: 'skipped', why: 'over-budget' });
  });

  it('a skipped row does not stop a later row that still fits', () => {
    const entries = [png('a.png', 2 * MIB), png('b.png', 2 * MIB), png('c.png', 2 * MIB), png('d.png', 1000)];
    const p = planMockupAssets(['a.png', 'b.png', 'c.png', 'd.png'].map((n) => ref(n)), committedCtx(entries));
    expect(kinds(p)).toEqual(['inline', 'inline', 'skipped', 'inline']);
    expect(p.reservedBytes).toBe(4 * MIB + 1000);
  });

  it('an asset listed over its class cap is skipped:too-large with no reservation; at the cap it is admitted', () => {
    const cap = DOCS_CLASS_CAP.raster;
    const p = planMockupAssets([ref('big.png'), ref('ok.png')], committedCtx([png('big.png', cap + 1), png('ok.png', cap)]));
    expect(p.rows[0]).toMatchObject({ verdict: { v: 'skipped', why: 'too-large' }, size: null });
    expect(p.rows[1]!.verdict.v).toBe('inline');
    expect(p.reservedBytes).toBe(cap);
  });

  it('a duplicate reference is budgeted once: both rows inline at the same pin, one reservation', () => {
    const p = planMockupAssets([ref('i.png'), ref('./i.png'), ref('i.png#x')], committedCtx([png('i.png', 1000)]));
    expect(kinds(p)).toEqual(['inline', 'inline', 'inline']);
    expect(p.rows[1]!.verdict).toEqual(p.rows[0]!.verdict);
    expect(p.rows[2]!.size).toEqual(p.rows[0]!.size);
    expect(p.reservedBytes).toBe(1000);
  });

  it('duplicates count once toward the 64 limit', () => {
    const { entries, names } = many(MOCKUP_MAX_ASSETS);
    const refs = [...names, ...names].map((n) => ref(n));
    const p = planMockupAssets(refs, committedCtx(entries));
    expect(kinds(p).every((k) => k === 'inline')).toBe(true);
    expect(p.reservedBytes).toBe(MOCKUP_MAX_ASSETS * 10);
  });

  it('rows that are not admitted all have size null, and the context is kept as given', () => {
    const ctx = committedCtx([png('i.png', 10)]);
    const p = planMockupAssets([ref('i.png'), ref('#a'), ref('nope.png')], ctx);
    expect(p.context).toBe(ctx);
    expect(p.rows.map((r) => r.size === null)).toEqual([false, true, true]);
  });
});

describe('planMockupAssets: the same-pin listed basis', () => {
  it('a tip committed page uses the listed sizes', () => {
    const p = planMockupAssets([ref('i.png')], committedCtx([png('i.png', 700)]));
    expect(p.rows[0]!.size).toEqual({ kind: 'listed', bytes: 700 });
    expect(p.reservedBytes).toBe(700);
  });

  it('a draft page\'s DraftPin uses the draft\'s listed size tied to its fingerprint', () => {
    const p = planMockupAssets([ref('i.png')], draftCtx([png('i.png', 700, { draft: draftOf('modified', { size: 321 }) })]));
    expect(p.rows[0]!.size).toEqual({ kind: 'listed', bytes: 321 });
    expect(p.reservedBytes).toBe(321);
  });

  it('a draft page\'s committed fallback is never used for an asset with no draft: it reads the committed size', () => {
    const p = planMockupAssets([ref('i.png')], draftCtx([png('i.png', 700)]));
    expect(p.rows[0]!.verdict).toMatchObject({ v: 'inline', pin: committedAsset('i.png'), draft: false });
    expect(p.rows[0]!.size).toEqual({ kind: 'listed', bytes: 700 });
  });
});

describe('planMockupAssets: a historical page (D-8659)', () => {
  const cap = DOCS_CLASS_CAP.raster;
  const three = (size: number): MockupContext =>
    committedCtx([png('a.png', size), png('b.png', size), png('c.png', size)], { pinCommit: COMMIT_B });

  it('the same tip listing with a small and with a large listed size gives identical admission, at the class cap', () => {
    const small = planMockupAssets(['a.png', 'b.png', 'c.png'].map((n) => ref(n, { key: n })), three(10));
    const large = planMockupAssets(['a.png', 'b.png', 'c.png'].map((n) => ref(n, { key: n })), three(cap));
    expect(small.rows).toEqual(large.rows);
    expect(small.reservedBytes).toBe(large.reservedBytes);
    expect(small.rows[0]!.verdict).toMatchObject({ v: 'inline', size: cap, pin: committedAsset('a.png', COMMIT_B) });
    expect(small.rows[0]!.size).toEqual({ kind: 'class-cap', bytes: cap });
  });

  it('a tip size over the cap does not refuse a historical asset: the tip\'s size is not the commit\'s', () => {
    const p = planMockupAssets([ref('a.png')], committedCtx([png('a.png', cap * 10)], { pinCommit: COMMIT_B }));
    expect(p.rows[0]!.verdict).toMatchObject({ v: 'inline', size: cap });
  });

  it('with 2 MiB caps two class-cap reservations fit and the third is skipped:over-budget, in that order', () => {
    const p = planMockupAssets(['a.png', 'b.png', 'c.png'].map((n) => ref(n)), three(10));
    expect(cap).toBe(2 * MIB);
    expect(verdicts(p).map((v) => v.v)).toEqual(['inline', 'inline', 'skipped']);
    expect(p.rows[2]!.verdict).toEqual({ v: 'skipped', why: 'over-budget' });
    expect(p.reservedBytes).toBe(2 * cap);
  });

  it('CSS discoveries share that same budget: after two reservations a third discovered asset is skipped', () => {
    const ctx = committedCtx([png('a.png', 10), png('b.png', 10), png('bg.png', 10)], { pinCommit: COMMIT_B });
    const first = planMockupAssets([ref('a.png'), ref('b.png')], ctx);
    const next = extendMockupAssetPlan(first, [cssRef('bg.png')]);
    expect(next.rows[2]!.verdict).toEqual({ v: 'skipped', why: 'over-budget' });
    expect(next.reservedBytes).toBe(2 * cap);
  });

  it('nothing in the planner reaches the network: a global fetch that throws is never called', () => {
    const fetchSpy = vi.fn(() => { throw new Error('the planner fetched'); });
    vi.stubGlobal('fetch', fetchSpy);
    try {
      const p = planMockupAssets([ref('a.png')], three(10));
      extendMockupAssetPlan(p, [cssRef('b.png')]);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('a duplicate pin under another kind keeps its own kind, and reserves nothing more', () => {
    const ctx = committedCtx([entry('specs', 'x.js', { committed: { kind: 'file', blob: '1'.repeat(40), size: 40 } })]);
    const p = planMockupAssets([ref('x.js', { kind: 'script' }), ref('x.js', { kind: 'module' })], ctx);
    expect(verdicts(p).map((v) => (v.v === 'inline' ? v.kind : v.v))).toEqual(['script', 'module']);
    expect(p.reservedBytes).toBe(40);
  });

  it('a mismatched context throws even when no reference needs a pin', () => {
    const tree = treeOk({ entries: [entry('specs', PAGE)], drafts: holder() });
    expect(() => planMockupAssets([ref('#x'), ref('https://a.example/p.png')], { project: 'demo', pin: draftPin, tree }))
      .toThrow(MockupContextMismatch);
  });
});

describe('extendMockupAssetPlan: nested admission within one attempt', () => {
  it('keeps the plan\'s own context object and every prior row, appending the new rows in the given order', () => {
    const ctx = committedCtx([png('a.png', 10), png('bg.png', 20), png('f.woff2', 30)]);
    const first = planMockupAssets([ref('a.png'), ref('#x')], ctx);
    const next = extendMockupAssetPlan(first, [cssRef('bg.png'), cssRef('f.woff2', { kind: 'font' })]);
    expect(next.context).toBe(first.context);
    expect(next).not.toBe(first);
    expect(first.rows).toHaveLength(2);
    next.rows.slice(0, 2).forEach((r, i) => { expect(r).toBe(first.rows[i]); });
    expect(kinds(next)).toEqual(['inline', 'kept', 'inline', 'inline']);
    expect(next.rows[3]!.verdict).toMatchObject({ mime: 'font/woff2', kind: 'font' });
    expect(next.reservedBytes).toBe(10 + 20 + 30);
  });

  it('two separately built contexts with conflicting listings each decide by their own captured context', () => {
    const withIt = committedCtx([png('a.png', 10), png('bg.png', 20)]);
    const withheld = draftCtx([png('a.png', 10), png('bg.png', 20, { draft: draftOf('modified', { fp: null }) })]);
    const a = extendMockupAssetPlan(planMockupAssets([ref('a.png')], withIt), [cssRef('bg.png')]);
    const b = extendMockupAssetPlan(planMockupAssets([ref('a.png')], withheld), [cssRef('bg.png')]);
    expect(a.rows[1]!.verdict).toMatchObject({ v: 'inline', pin: committedAsset('bg.png') });
    expect(b.rows[1]!.verdict).toEqual({ v: 'missing', why: 'draft-withheld' });
    expect(a.context).toBe(withIt);
    expect(b.context).toBe(withheld);
  });

  it('the 64-count boundary alone: 63 root assets plus one nested are admitted, the next nested is skipped', () => {
    const { entries, names } = many(MOCKUP_MAX_ASSETS - 1);
    const ctx = committedCtx([...entries, png('n1.png', 10), png('n2.png', 10)]);
    const root = planMockupAssets(names.map((n) => ref(n)), ctx);
    expect(root.reservedBytes).toBeLessThan(MIB);
    const one = extendMockupAssetPlan(root, [cssRef('n1.png')]);
    expect(one.rows[MOCKUP_MAX_ASSETS - 1]!.verdict.v).toBe('inline');
    const two = extendMockupAssetPlan(one, [cssRef('n2.png')]);
    expect(two.rows[MOCKUP_MAX_ASSETS]!.verdict).toEqual({ v: 'skipped', why: 'over-budget' });
    expect(two.rows[MOCKUP_MAX_ASSETS]!.size).toBeNull();
    expect(two.reservedBytes).toBe(MOCKUP_MAX_ASSETS * 10);
  });

  it('the 5 MiB boundary alone: a nested asset that would pass 5 MiB is skipped, with far fewer than 64 rows', () => {
    const ctx = committedCtx([png('a.png', 2 * MIB), png('b.png', 2 * MIB), png('ok.png', MIB), png('over.png', MIB + 1), png('tiny.png', 1)]);
    const root = planMockupAssets([ref('a.png'), ref('b.png')], ctx);
    const over = extendMockupAssetPlan(root, [cssRef('over.png')]);
    expect(over.rows[2]!.verdict).toEqual({ v: 'skipped', why: 'over-budget' });
    expect(over.reservedBytes).toBe(4 * MIB);
    const exact = extendMockupAssetPlan(over, [cssRef('ok.png'), cssRef('tiny.png')]);
    expect(kinds(exact)).toEqual(['inline', 'inline', 'skipped', 'inline', 'skipped']);
    expect(exact.reservedBytes).toBe(MOCKUP_MAX_ASSET_BYTES);
  });

  it('a failed admitted row survives extension with its size, and its reservation stays', () => {
    const ctx = committedCtx([png('a.png', 700), png('bg.png', 50)]);
    const first = planMockupAssets([ref('a.png')], ctx);
    const failed = { ...first, rows: first.rows.map((r) => ({ ...r, verdict: { v: 'failed', failure: 'x' } as MockupRefVerdict })) };
    const next = extendMockupAssetPlan(failed, [cssRef('bg.png')]);
    expect(next.rows[0]).toBe(failed.rows[0]);
    expect(next.rows[0]!.verdict).toEqual({ v: 'failed', failure: 'x' });
    expect(next.rows[0]!.size).toEqual({ kind: 'listed', bytes: 700 });
    expect(next.reservedBytes).toBe(750);
  });

  it('a failed admitted pin rediscovered in CSS is one admitted identity: one reservation, the failed verdict copied', () => {
    const ctx = committedCtx([png('a.png', 700)]);
    const first = planMockupAssets([ref('a.png')], ctx);
    const failed: MockupAssetPlan = { ...first, rows: first.rows.map((r) => ({ ...r, verdict: { v: 'failed', failure: 'x' } })) };
    const next = extendMockupAssetPlan(failed, [cssRef('a.png')]);
    expect(next.reservedBytes).toBe(700);
    expect(next.rows).toHaveLength(2);
    expect(next.rows[1]!.verdict).toEqual({ v: 'failed', failure: 'x' });
    expect(next.rows[1]!.size).toEqual({ kind: 'listed', bytes: 700 });
  });

  it('a failed admitted pin rediscovered still counts once toward the 64 limit', () => {
    const { entries, names } = many(MOCKUP_MAX_ASSETS);
    const ctx = committedCtx([...entries, png('extra.png', 10)]);
    const first = planMockupAssets(names.map((n) => ref(n)), ctx);
    const failed: MockupAssetPlan = { ...first, rows: first.rows.map((r) => ({ ...r, verdict: { v: 'failed', failure: 'x' } })) };
    const next = extendMockupAssetPlan(failed, [cssRef(names[0]!), cssRef('extra.png')]);
    expect(next.rows[MOCKUP_MAX_ASSETS]!.verdict).toEqual({ v: 'failed', failure: 'x' });
    expect(next.rows[MOCKUP_MAX_ASSETS + 1]!.verdict).toEqual({ v: 'skipped', why: 'over-budget' });
    expect(next.reservedBytes).toBe(MOCKUP_MAX_ASSETS * 10);
  });

  it('an earlier skipped identity is skipped the same way when it is rediscovered', () => {
    const ctx = committedCtx([png('a.png', 2 * MIB), png('b.png', 2 * MIB), png('c.png', 2 * MIB)]);
    const first = planMockupAssets([ref('a.png'), ref('b.png'), ref('c.png')], ctx);
    const next = extendMockupAssetPlan(first, [cssRef('c.png')]);
    expect(next.rows[3]!.verdict).toEqual({ v: 'skipped', why: 'over-budget' });
    expect(next.rows[3]!.size).toBeNull();
    expect(next.reservedBytes).toBe(4 * MIB);
  });
});
