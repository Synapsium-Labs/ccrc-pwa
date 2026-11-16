// Export's input, assembled (spec 2026-10-01 4.17; native Docs reader W5, Export; refinements (l), (s)). From what the
// header found ready to export (`ExportSource`: a parsed tree with the page's store, a plain body, a text leaf with its
// one-block store, an SVG's bytes, or a raster's image, each with the pin it shows), `exportInputOf` builds what
// `buildExport` takes: the title (a Markdown export's first `h1`, else the file name), the file name, the provenance and
// the body. The sheet adds the export time and the exporter's palette.
//
// Ring L1: pure; it loads no `.tsx` at run time (the builder's, the body's and the registry's types are type-only).
import type { Element as HastElement, Root as HastRoot, RootContent } from 'hast';
import { contentClass, type DocPin, type DocsPageLocation, type DocsShowOk, type DocsTreeOk } from '../../../../shared/docs';
import type { HighlightStore } from '../../lib/highlightStore';
import { leafName } from '../docsTree';
import type { ExportBody } from '../exportBody';
import type { ExportBodyInput, ExportInput } from './buildExport';
import type { ExportAsset, ExportAssets } from './exportAssets';
import { exportFilename } from './filename';
import { exportProvenance } from './provenance';

type Leaf = DocsPageLocation & { kind: 'path' };

/** What a leaf that is ready to export holds (`DocsHead.tsx#exportStateFor`'s answer). */
export type ExportSource =
  | {
    readonly kind: 'tree'; readonly pin: DocPin; readonly show: DocsShowOk;
    readonly body: Extract<ExportBody, { kind: 'tree' }>; readonly store: HighlightStore;
  }
  | { readonly kind: 'plain'; readonly pin: DocPin; readonly show: DocsShowOk; readonly body: Extract<ExportBody, { kind: 'plain' }> }
  | {
    readonly kind: 'text'; readonly pin: DocPin; readonly show: DocsShowOk;
    readonly body: Extract<ExportBody, { kind: 'text' }>; readonly store: HighlightStore | null;
  }
  | { readonly kind: 'svg'; readonly pin: DocPin; readonly show: DocsShowOk; readonly bytes: Uint8Array }
  | { readonly kind: 'raster'; readonly pin: DocPin; readonly asset: Extract<ExportAsset, { kind: 'raster' }> };

/** What the header hands the sheet at the tap. */
export interface ExportRequest {
  readonly page: Leaf;
  readonly tree: DocsTreeOk;
  readonly source: ExportSource;
  readonly assets: ExportAssets | null;
  /** When the leaf's bytes were read (its file slot's `receivedAt`); `null`: a raster leaf, which has no file slot. */
  readonly readAt: number | null;
}

// A copy of the private `lib/highlightStore.ts#textOf`, kept so that file stays untouched.
function textOf(el: HastElement): string {
  let out = '';
  const stack: RootContent[] = [...el.children].reverse();
  while (stack.length > 0) {
    const n = stack.pop()!;
    if (n.type === 'text') out += n.value;
    else if (n.type === 'element') for (let k = n.children.length - 1; k >= 0; k -= 1) stack.push(n.children[k]!);
  }
  return out;
}

/** The text of `tree`'s first `h1`; `null`: it has none, or it is empty. Iterative. */
export function firstHeading(tree: HastRoot): string | null {
  const stack: RootContent[] = [...tree.children].reverse();
  while (stack.length > 0) {
    const n = stack.pop()!;
    if (n.type !== 'element') continue;
    if (n.tagName === 'h1') {
      const text = textOf(n);
      return text === '' ? null : text;
    }
    for (let k = n.children.length - 1; k >= 0; k -= 1) stack.push(n.children[k]!);
  }
  return null;
}

function bodyOf(source: ExportSource, alt: string): ExportBodyInput {
  switch (source.kind) {
    case 'tree':
      return { kind: 'tree', tree: source.body.tree, urls: source.body.urls, link: source.body.link, store: source.store };
    case 'plain':
      return { kind: 'plain', text: source.body.text, note: source.body.note };
    case 'text':
      return { kind: 'text', text: source.body.text, lang: source.body.lang, store: source.store };
    case 'svg':
      return { kind: 'image', alt, draft: source.pin.kind === 'draft', image: { kind: 'svg', bytes: source.bytes } };
    case 'raster':
      return {
        kind: 'image', alt, draft: source.pin.kind === 'draft',
        image: { kind: 'raster', bytes: source.asset.bytes, mime: source.asset.mime },
      };
  }
}

export function exportInputOf(r: ExportRequest, o: { readonly exportedAt: number; readonly theme: string | null }): ExportInput {
  const { page, tree, source } = r;
  const provenance = exportProvenance({
    tree, page, pin: source.pin, show: source.kind === 'raster' ? null : source.show, exportedAt: o.exportedAt,
    readAt: r.readAt ?? o.exportedAt, plainView: contentClass(page.path) === 'markdown',
  });
  const name = leafName(page.path);
  return {
    title: source.kind === 'tree' ? firstHeading(source.body.tree) ?? name : name,
    name: exportFilename(page.project, source.pin, provenance.commit),
    theme: o.theme,
    commit: provenance.commit,
    provenance,
    body: bodyOf(source, name),
    assets: source.kind === 'tree' ? r.assets : null,
  };
}
