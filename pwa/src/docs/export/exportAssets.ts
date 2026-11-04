// Export's images, from memory (spec 2026-10-01 4.3 item 6, 4.17 "Images: bytes already in memory, never fetched";
// native Docs reader W5, Export; refinement (g)). One registry per Docs visit: `DocsScreen` makes it beside the image
// queue and gives it to every image through `DocsAssetContext`. Each `DocImage` tracks its key (`docsApi.file(project,
// pin)`, which names the pin exactly, a draft's fingerprint included) while it shows that key, and reports what became of
// its load: loading, the bytes it holds (a raster's verified bytes with their table MIME, an SVG's `data:` URL), or
// failed. The registry holds those by reference, never copies them, and forgets a key when the last image showing it
// goes, so it holds no more than the page does and never answers bytes older than the page shows (M4.EX3). Export reads
// it and never a loader: `settleExportAssets` waits, at most its bound (`DOCS_EXPORT_IMAGE_WAIT_MS` in production), for
// the keys still loading.
//
// Ring L3 (its wait holds a timer): it reads no DOM and makes no request.
import type { RasterMime } from '../../../../shared/docs';

/** What an image holds once loaded. */
export type ExportAsset =
  | { readonly kind: 'raster'; readonly bytes: Uint8Array<ArrayBuffer>; readonly mime: RasterMime }
  | { readonly kind: 'svg'; readonly src: string };

/** One key's state. A key the registry does not hold answers `undefined` from `get`: no image shows it. */
export type ExportAssetState =
  | { readonly s: 'loading' }
  | { readonly s: 'loaded'; readonly asset: ExportAsset }
  | { readonly s: 'failed' };

export const ASSET_LOADING: ExportAssetState = Object.freeze({ s: 'loading' } as const);
export const ASSET_FAILED: ExportAssetState = Object.freeze({ s: 'failed' } as const);

/** One image's hold on its key. */
export interface ExportAssetHold {
  report(state: ExportAssetState): void;
  release(): void;
}

export interface ExportAssets {
  track(key: string): ExportAssetHold;
  get(key: string): ExportAssetState | undefined;
  /** Store-wide; the same function on every call, for `useSyncExternalStore`. */
  readonly subscribe: (listener: () => void) => () => void;
  /** Bumped on every change, for `useSyncExternalStore`'s snapshot. */
  version(): number;
}

export function createExportAssets(): ExportAssets {
  const rows = new Map<string, { holds: number; state: ExportAssetState }>();
  const listeners = new Set<() => void>();
  let version = 0;
  const changed = (): void => {
    version += 1;
    for (const listener of [...listeners]) listener();
  };
  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };
  return {
    track(key) {
      const row = rows.get(key) ?? { holds: 0, state: ASSET_LOADING };
      row.holds += 1;
      rows.set(key, row);
      let live = true;
      return {
        report(state) {
          if (!live || rows.get(key) !== row) return;
          row.state = state;
          changed();
        },
        release() {
          if (!live) return;
          live = false;
          row.holds -= 1;
          if (row.holds === 0 && rows.get(key) === row) {
            rows.delete(key);
            changed();
          }
        },
      };
    },
    get: (key) => rows.get(key)?.state,
    subscribe,
    version: () => version,
  };
}

/** Resolves once no key of `keys` is `loading`, or after `ms`, whichever is first. It never rejects. */
export function settleExportAssets(assets: ExportAssets, keys: readonly string[], ms: number): Promise<void> {
  const loading = (): boolean => keys.some((k) => assets.get(k)?.s === 'loading');
  if (!loading()) return Promise.resolve();
  return new Promise<void>((resolve) => {
    let done = false;
    let stop: (() => void) | null = null;
    const finish = (): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      stop?.();
      resolve();
    };
    const timer = setTimeout(finish, ms);
    stop = assets.subscribe(() => {
      if (!loading()) finish();
    });
  });
}
