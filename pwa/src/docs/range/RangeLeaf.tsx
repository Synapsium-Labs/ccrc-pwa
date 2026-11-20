// A leaf read by range (X2 P1 Tasks P1.4 and P1.5; spec 4.3): a file above its class cap, or a draft the listing could
// not fingerprint. Over `DOCS_RANGE_MAX_BYTES` it says so and offers nothing that would read past the ceiling. Up to it,
// the read shows its progress and a Cancel, runs frame by frame (`readRange`), and hands the checked bytes to
// `children` (Markdown in parts, or the image view); a class with no view above its cap gets a Download that reads the
// file by range first. Cancel, leaving the page or opening another doc aborts the read and drops every frame held.
import { useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { DocsAssetContext } from '../DocImage';
import { ASSET_FAILED } from '../export/exportAssets';
import { Button } from '@ccrc/ui';
import {
  DOCS_IMAGE_VIEW_MAX_PIXELS, DOCS_IMAGE_VIEW_MAX_SIDE, DOCS_RANGE_MAX_BYTES, docsRangePinText, sniffRaster, type DocContentClass,
  type DocPin,
} from '../../../../shared/docs';
import { DOCS_RANGE_TEXT, DOCS_VIEW_TEXT, failureSentence, fillSentence, mib, slotSentence } from '../docsText';
import { declaredRaster } from '../failures';
import { rasterObjectUrl, saveBytes } from '../objectUrls';
import { imageHeaderDims, imageViewVerdict, rangeVerdict } from './rangePolicy';
import { readRange, type RangeLoader, type RangeReadFailure, type RangeTarget } from './readRange';

/** The words for a read that gave no bytes. */
export function rangeFailureSentence(why: RangeReadFailure, size: number): string {
  switch (why.kind) {
    case 'answer':
      return why.answer.s === 'failed' ? failureSentence(why.answer.body) : slotSentence(why.answer);
    case 'aborted':
      return DOCS_RANGE_TEXT.cancelled;
    case 'size-mismatch':
      return DOCS_VIEW_TEXT.changing;
    case 'over-ceiling':
      return fillSentence(DOCS_RANGE_TEXT.overCeiling, { size: mib(size), cap: mib(DOCS_RANGE_MAX_BYTES) });
    case 'frame-mismatch':
    case 'frame-digest':
      return DOCS_RANGE_TEXT.mismatch;
    case 'no-digest':
      return DOCS_RANGE_TEXT.noDigest;
    case 'whole-digest':
      return DOCS_RANGE_TEXT.mismatch;
    case 'threw':
      return DOCS_RANGE_TEXT.threw;
  }
}

type ReadState =
  | { s: 'idle' }
  | { s: 'reading'; done: number; total: number }
  | { s: 'done'; bytes: Uint8Array<ArrayBuffer>; digest: string }
  | { s: 'failed'; why: RangeReadFailure };

/** The bytes a range read gave, and their digest (the snapshot's sha256, which a stat-pinned draft's page pin takes as
 *  its `fp`). */
export interface RangeBytes { readonly bytes: Uint8Array<ArrayBuffer>; readonly digest: string }

/** One read's identity: the project, the place, the range pin and the size. A leaf is keyed by it (`DocsLeaf` gives it as
 *  the element's `key`), so another doc is another instance with its own state, and a re-render that rebuilds an equal
 *  target object reads nothing again. */
export function rangeReadKey(t: RangeTarget): string {
  return [t.project, t.pin.section, t.pin.path, docsRangePinText(t.range), String(t.size)].join('\u0000');
}

export function RangeLeaf(p: {
  readonly target: RangeTarget;
  readonly cls: DocContentClass;
  readonly name: string;
  readonly loader: RangeLoader;
  /** The view of the bytes once read; absent, the class has no view above its cap and the leaf offers Download only. */
  readonly children?: (read: RangeBytes) => ReactNode;
}): ReactNode {
  const key = rangeReadKey(p.target);
  const verdict = rangeVerdict(p.target.size, p.cls, p.target.range.kind);
  const hasView = p.children !== undefined;
  // The newest props, read by a read in flight: a re-render's new objects never restart it.
  const latest = useRef({ target: p.target, loader: p.loader, name: p.name, hasView });
  latest.current = { target: p.target, loader: p.loader, name: p.name, hasView };
  const [state, setState] = useState<ReadState>({ s: 'idle' });
  const ac = useRef<AbortController | null>(null);

  const start = useCallback((save: boolean) => {
    ac.current?.abort();
    const mine = new AbortController();
    ac.current = mine;
    const { target, loader } = latest.current;
    setState({ s: 'reading', done: 0, total: target.size });
    void readRange(loader, target, {
      signal: mine.signal,
      onProgress: (done, total) => { if (!mine.signal.aborted) setState({ s: 'reading', done, total }); },
    }).then((r) => {
      if (ac.current !== mine) return;
      if (!r.ok) { setState({ s: 'failed', why: r.why }); return; }
      if (save) saveBytes(latest.current.name, r.bytes);
      setState(save && !latest.current.hasView ? { s: 'idle' } : { s: 'done', bytes: r.bytes, digest: r.digest });
    }, () => { if (ac.current === mine) setState({ s: 'failed', why: { kind: 'threw' } }); });
  }, []);

  // A leaf with a view reads as soon as it opens, once per read key; leaving it aborts the read, whatever its state.
  useEffect(() => {
    if (verdict !== 'over-ceiling' && hasView) start(false);
    return () => { ac.current?.abort(); ac.current = null; };
  }, [key, verdict, hasView, start]);
  const { target } = p;
  const view = p.children;

  if (verdict === 'over-ceiling') {
    return (
      <p className="docs-note" role="status">
        {fillSentence(DOCS_RANGE_TEXT.overCeiling, { size: mib(target.size), cap: mib(DOCS_RANGE_MAX_BYTES) })}
      </p>
    );
  }
  const cancel = (): void => {
    ac.current?.abort();
    ac.current = null;
    setState({ s: 'failed', why: { kind: 'aborted' } });
  };
  const download = (
    <Button variant="ghost" className="docs-leaf-action" disabled={state.s === 'reading'}
      onClick={() => { if (state.s === 'done') saveBytes(p.name, state.bytes); else start(true); }}>
      {DOCS_VIEW_TEXT.download}
    </Button>
  );
  if (state.s === 'reading') {
    return (
      <div className="docs-range-reading" role="status">
        <p className="docs-loading">{fillSentence(DOCS_RANGE_TEXT.reading, { done: mib(state.done), total: mib(state.total) })}</p>
        <progress max={state.total} value={state.done} />
        <Button variant="ghost" className="docs-range-cancel" onClick={cancel}>{DOCS_RANGE_TEXT.cancel}</Button>
      </div>
    );
  }
  if (state.s === 'failed') {
    return (
      <>
        <p className="docs-note" role="alert">{rangeFailureSentence(state.why, target.size)}</p>
        <div className="docs-leaf-actions">
          {view !== undefined && <Button variant="ghost" className="docs-fail-action" onClick={() => start(false)}>{DOCS_RANGE_TEXT.readAgain}</Button>}
          {download}
        </div>
      </>
    );
  }
  if (state.s === 'done' && view !== undefined) {
    return <>{view({ bytes: state.bytes, digest: state.digest })}<div className="docs-leaf-actions">{download}</div></>;
  }
  return (
    <>
      <p className="docs-note">{fillSentence(DOCS_RANGE_TEXT.downloadOnly, { size: mib(target.size) })}</p>
      <div className="docs-leaf-actions">{download}</div>
    </>
  );
}

/** The image view above the class cap (spec 4.3): the header's dimensions checked before any decode, the bytes checked
 *  against the declared raster type, then one object URL of that type, revoked when the view goes. */
export function RangeImage(p: {
  readonly bytes: Uint8Array<ArrayBuffer>; readonly path: string; readonly name: string;
  /** Export's registry key for the leaf's own image (`docsApi.file` of the page pin), or null: nothing is registered. */
  readonly assetKey?: string | null;
  /** Called once the image is shown, with the pin it opened at (Share waits for the leaf's image, spec 4.16). */
  readonly onShown?: ((pin: DocPin) => void) | null;
  readonly openedPin?: DocPin | null;
}): ReactNode {
  const declared = declaredRaster(p.path);
  const dims = imageHeaderDims(p.bytes);
  const verdict = dims === null ? null : imageViewVerdict(dims);
  const matches = declared !== null && sniffRaster(declared, p.bytes) === 'match';
  const [url, setUrl] = useState<string | null>(null);
  const assets = useContext(DocsAssetContext);
  const latest = useRef({ onShown: p.onShown ?? null, openedPin: p.openedPin ?? null });
  latest.current = { onShown: p.onShown ?? null, openedPin: p.openedPin ?? null };
  const assetKey = p.assetKey ?? null;
  useEffect(() => {
    const hold = assetKey === null || assets?.exportAssets == null ? null : assets.exportAssets.track(assetKey);
    if (declared === null || !matches || verdict !== 'show') {
      hold?.report(ASSET_FAILED);
      return () => hold?.release();
    }
    const mime = mimeOf(declared);
    const u = rasterObjectUrl(p.bytes, mime);
    setUrl(u);
    hold?.report({ s: 'loaded', asset: { kind: 'raster', bytes: p.bytes, mime } });
    const { onShown, openedPin } = latest.current;
    if (onShown !== null && openedPin !== null) onShown(openedPin);
    return () => { hold?.release(); URL.revokeObjectURL(u); setUrl(null); };
  }, [p.bytes, declared, matches, verdict, assetKey, assets]);
  if (!matches) return <p className="docs-note" role="status">{DOCS_RANGE_TEXT.imageMismatch}</p>;
  if (dims === null) return <p className="docs-note" role="status">{DOCS_RANGE_TEXT.imageNoHeader}</p>;
  if (verdict === 'side') {
    return <p className="docs-note" role="status">{fillSentence(DOCS_RANGE_TEXT.imageSide, { w: dims.w, h: dims.h, side: DOCS_IMAGE_VIEW_MAX_SIDE })}</p>;
  }
  if (verdict === 'pixels') {
    return (
      <p className="docs-note" role="status">
        {fillSentence(DOCS_RANGE_TEXT.imagePixels, { w: dims.w, h: dims.h, px: Math.floor(DOCS_IMAGE_VIEW_MAX_PIXELS / 1048576) })}
      </p>
    );
  }
  // `msg-img` holds the image to the page's width (DocImage's own class); width and height are the aspect hint only.
  return url === null ? null : <div className="docs-raster"><img className="msg-img" src={url} alt={p.name} width={dims.w} height={dims.h} /></div>;
}

function mimeOf(t: NonNullable<ReturnType<typeof declaredRaster>>): Parameters<typeof rasterObjectUrl>[1] {
  return RASTER_MIME[t];
}

const RASTER_MIME = { png: 'image/png', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' } as const;
