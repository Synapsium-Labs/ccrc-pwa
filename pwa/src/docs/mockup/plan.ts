// The mockup viewer's asset planner (native Docs reader, completion plan Task 6; base spec 2026-10-01 section 5.6.3's Pins,
// verdict union and Budgets, as amended for D-8659). Ring L1: pure and deterministic, no DOM, no I/O, no timer and no
// module state. It decides, from ONE captured `MockupContext` and before any fetch, what each reference of a mockup
// becomes: which bytes it may show (`imagePinFor`, the Docs reader's one pin rule, never a second one), whether its
// extension fits its kind, whether its reservation fits the attempt's budget, and which duplicate it shares with an
// admitted reference. The loader reads exactly the pins this plan admits; no adapter receives admission authority.
import {
  DOCS_CLASS_CAP, contentClass, docsApi, resolveDocRef,
  type DocContentClass, type DocPin, type DocSectionSlug, type DocsEntry, type DocsPageLocation, type DocsTreeOk,
} from '../../../../shared/docs';
import { imagePinFor } from '../docsLinks';
import {
  MOCKUP_MAX_ASSET_BYTES, MOCKUP_MAX_ASSETS, MOCKUP_MAX_CSS_DEPTH, mockupMimeRow,
} from './policy';
import type { MockupAssetPlan, MockupAssetRow, MockupContext, MockupRef, MockupRefVerdict, MockupSize } from './ports';

type Leaf = Extract<DocsPageLocation, { kind: 'path' }>;

/** The context's own page pin is not the pin the one pin rule gives the page in the tree the attempt listed (the page
 *  is not listed, or the tree no longer opens that draft). The caller decides what an attempt does about it; this
 *  function invents nothing. */
export class MockupContextMismatch extends Error {
  constructor(detail: string) {
    super(`mockup context mismatch: ${detail}`);
    this.name = 'MockupContextMismatch';
  }
}

/** The page location `imagePinFor` reads for this context's page: a committed page pin is the default view of the
 *  page, at its version when the pin's commit is not the listing's own (`at`), and a draft page pin is a ref view of
 *  the draft's branch. The one pin rule (`imagePinFor`) applied to the page's own entry must answer the context's own
 *  pin, as `pinFor` would; when it does not, this throws `MockupContextMismatch`. Asking `imagePinFor` rather than
 *  `pinFor` keeps this L1 file's runtime imports to L0 and `docsLinks`. */
export function mockupPage(ctx: MockupContext): Leaf {
  const { pin, tree, project } = ctx;
  const page: Leaf = pin.kind === 'committed'
    ? {
      kind: 'path', project, section: pin.section, path: pin.path, dirSlash: false, ref: null,
      at: pin.commit === tree.ref.commit ? null : pin.commit, view: 'effective', frame: 'inline',
    }
    : {
      kind: 'path', project, section: pin.section, path: pin.path, dirSlash: false, ref: { kind: 'bare', name: pin.branch },
      at: null, view: 'effective', frame: 'inline',
    };
  const own = imagePinFor(tree.entries.find((e) => e.section === pin.section && e.path === pin.path), tree, page);
  if (!own.ok || docsApi.file(project, own.pin) !== docsApi.file(project, pin)) {
    throw new MockupContextMismatch(`the listing does not open ${pin.section}/${pin.path} as the page's ${pin.kind} pin`);
  }
  return page;
}

/** The basis of one admitted pin's reservation (D-8659), reused by the Docs plain view's size pre-check. `listed`: the
 *  listing's size, used only when it belongs to the exact pin (a committed pin at the listing's own commit, or a draft
 *  pin at the listed fingerprint). `class-cap`: the class's full cap, for a historical commit and for a size the
 *  listing does not hold. The tip's size is never read for a historical commit. */
export function mockupSizeBasis(
  entry: DocsEntry | undefined, tree: DocsTreeOk, pin: DocPin, cls: DocContentClass,
): MockupSize {
  if (entry !== undefined) {
    if (pin.kind === 'committed') {
      const size = entry.committed?.size;
      if (pin.commit === tree.ref.commit && typeof size === 'number') return { kind: 'listed', bytes: size };
    } else {
      const d = entry.draft;
      if (d !== null && d.fp === pin.fp && typeof d.size === 'number') return { kind: 'listed', bytes: d.size };
    }
  }
  return { kind: 'class-cap', bytes: DOCS_CLASS_CAP[cls] };
}

/** What a reference came to before the budget is asked: a verdict that needs no bytes, or a pin to admit. */
type Derived =
  | { readonly final: MockupRefVerdict }
  | { readonly pin: DocPin; readonly mime: string; readonly size: MockupSize };

interface Held { readonly verdict: MockupRefVerdict; readonly size: MockupSize }

/** Steps 1-5 of the plan's decision for one reference: depth, `resolveDocRef`, kind fit, the pin rule, the size basis.
 *  A function of the reference and the context alone, so an already-admitted row's pin is re-derived from its own ref. */
function deriveFor(ctx: MockupContext): (ref: MockupRef) => Derived {
  let index: Map<string, DocsEntry> | null = null;
  // Checked up front, so a mismatched context throws whatever its references are, not only when one needs a pin.
  const page = mockupPage(ctx);
  const entryAt = (section: string, path: string): DocsEntry | undefined => {
    if (index === null) {
      index = new Map();
      for (const e of ctx.tree.entries) {
        const key = `${e.section}\u0000${e.path}`;
        if (!index.has(key)) index.set(key, e);
      }
    }
    return index.get(`${section}\u0000${path}`);
  };
  return (ref) => {
    if (ref.depth > MOCKUP_MAX_CSS_DEPTH) return { final: { v: 'unsupported', why: 'css-depth' } };
    const slash = ref.basePath.indexOf('/');
    const from = { section: ref.basePath.slice(0, slash) as DocSectionSlug, path: ref.basePath.slice(slash + 1) };
    const r = resolveDocRef(from, ref.raw);
    switch (r.kind) {
      case 'fragment':
        return { final: { v: 'kept', why: 'fragment' } };
      case 'self-contained':
        return { final: { v: 'kept', why: 'self-contained' } };
      case 'external':
        return { final: r.origin === null ? { v: 'refused', why: 'scheme' } : { v: 'external', origin: r.origin, via: 'src' } };
      case 'repo':
        return { final: { v: 'refused', why: 'repo' } };
      case 'refused':
        return { final: { v: 'refused', why: r.why } };
      case 'doc':
        break;
    }
    const row = mockupMimeRow(r.path);
    if (row === null || !row.kinds.includes(ref.kind)) return { final: { v: 'unsupported', why: 'kind' } };
    const e = entryAt(r.section, r.path);
    const ip = imagePinFor(e, ctx.tree, page);
    if (!ip.ok) {
      return { final: { v: 'missing', why: ip.why === 'absent' ? 'absent-at-commit' : ip.why } };
    }
    return { pin: ip.pin, mime: row.mime, size: mockupSizeBasis(e, ctx.tree, ip.pin, contentClass(r.path)) };
  };
}

/** THE decision, shared by both entry points: `prior` rows stay as they are and in order, `refs` are decided in the
 *  given order against what `prior` admitted (its distinct pins, their count and `plan.reservedBytes`). */
function decide(
  context: MockupContext, prior: readonly MockupAssetRow[], reservedBytes: number, refs: readonly MockupRef[],
): MockupAssetPlan {
  const derive = deriveFor(context);
  const admitted = new Map<string, Held>();
  for (const row of prior) {
    if (row.size === null) continue;
    const d = derive(row.ref);
    if (!('pin' in d)) continue;
    const id = docsApi.file(context.project, d.pin);
    if (!admitted.has(id)) admitted.set(id, { verdict: row.verdict, size: row.size });
  }
  const rows: MockupAssetRow[] = [...prior];
  let count = admitted.size;
  let reserved = reservedBytes;
  for (const ref of refs) {
    const d = derive(ref);
    if ('final' in d) {
      rows.push({ ref, verdict: d.final, size: null });
      continue;
    }
    const cap = DOCS_CLASS_CAP[contentClass(d.pin.path)];
    if (d.size.kind === 'listed' && d.size.bytes > cap) {
      rows.push({ ref, verdict: { v: 'skipped', why: 'too-large' }, size: null });
      continue;
    }
    const id = docsApi.file(context.project, d.pin);
    const held = admitted.get(id);
    if (held !== undefined) {
      // The same bytes, reserved once; an inline duplicate keeps its own reference's kind (a module beside a classic
      // script of the same file still loads as a module), which the kind check above already admitted.
      const verdict = held.verdict.v === 'inline' ? { ...held.verdict, kind: ref.kind } : held.verdict;
      rows.push({ ref, verdict, size: held.size });
      continue;
    }
    if (count + 1 > MOCKUP_MAX_ASSETS || reserved + d.size.bytes > MOCKUP_MAX_ASSET_BYTES) {
      rows.push({ ref, verdict: { v: 'skipped', why: 'over-budget' }, size: null });
      continue;
    }
    const verdict: MockupRefVerdict = {
      v: 'inline', pin: d.pin, kind: ref.kind, mime: d.mime, size: d.size.bytes, draft: d.pin.kind === 'draft',
    };
    admitted.set(id, { verdict, size: d.size });
    count += 1;
    reserved += d.size.bytes;
    rows.push({ ref, verdict, size: d.size });
  }
  return { context, rows, reservedBytes: reserved };
}

/** The plan of one attempt's first references (the page's own), decided from `ctx` alone. Throws
 *  `MockupContextMismatch` when the context's own pin is not the one the pin rule gives its page in its tree. */
export function planMockupAssets(refs: readonly MockupRef[], ctx: MockupContext): MockupAssetPlan {
  return decide(ctx, [], 0, refs);
}

/** The same attempt's plan with newly discovered references (a stylesheet's) appended, decided by the same rules
 *  against the prior rows' admitted pins, their count and `plan.reservedBytes`. It keeps the plan's own context
 *  object, every prior row as it stands (a failed one included, its reservation kept), and starts no second plan. Throws
 *  `MockupContextMismatch` as `planMockupAssets` does. */
export function extendMockupAssetPlan(plan: MockupAssetPlan, refs: readonly MockupRef[]): MockupAssetPlan {
  return decide(plan.context, plan.rows, plan.reservedBytes, refs);
}
