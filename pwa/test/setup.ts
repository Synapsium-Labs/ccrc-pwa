import '@testing-library/jest-dom/vitest';

// jsdom gaps touched by vaul/radix (the Sheet primitive). All guarded so a
// future jsdom that implements them wins automatically.
if (typeof window !== 'undefined') {
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;

  window.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;

  window.HTMLElement.prototype.scrollIntoView ??= function scrollIntoView(): void {};
  window.HTMLElement.prototype.setPointerCapture ??= function setPointerCapture(): void {};
  window.HTMLElement.prototype.releasePointerCapture ??= function releasePointerCapture(): void {};
  window.HTMLElement.prototype.hasPointerCapture ??= function hasPointerCapture(): boolean {
    return false;
  };
}
