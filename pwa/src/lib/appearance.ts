// The host appearance as a hook (native Docs reader, appearance continuity, Task 3). L4: it holds a subscription.
//
// `useHostAppearance()` answers `appearanceStamp(document.documentElement)` and re-renders when the root's
// `data-skin` or `data-theme` changes, by whoever changed it: `applyTheme`, `applySkin`, `initTheme`'s live media
// listener (a system flip) or a test. It reads the ROOT, never the stored choice, because a "Follow the system"
// choice does not change when the operating system flips light and dark, but the root does.
//
// ONE MutationObserver serves every subscriber: it is created on the first subscribe and disconnected when the last
// one leaves, so a screen that never mounts the hook holds no observer. Its `attributeFilter` is the two attributes,
// so a change to any other attribute of the root wakes nothing.
import { useSyncExternalStore } from 'react';
import { appearanceStamp } from './appearanceStamp';

const listeners = new Set<() => void>();
let observer: MutationObserver | null = null;

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  if (observer === null) {
    observer = new MutationObserver(() => { for (const l of [...listeners]) l(); });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-skin', 'data-theme'] });
  }
  return () => {
    listeners.delete(onChange);
    if (listeners.size === 0 && observer !== null) {
      observer.disconnect();
      observer = null;
    }
  };
}

const snapshot = (): string => appearanceStamp(document.documentElement);

/** The stamp of the document root as it is now. During server rendering and hydration, the stamp of a bare root. */
export function useHostAppearance(): string {
  return useSyncExternalStore(subscribe, snapshot, () => '|');
}
