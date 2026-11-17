// The mockup's frame (native Docs reader, completion plan Task 8, C2, review A9; base spec 2026-10-01 5.6.1, 5.6.5, 5.6.6;
// row M5.13): what `MockupFrame` reads back from the page's own leading meta, and what it refuses. The frame is driven here
// with crafted `srcdoc` strings, because the viewer only ever hands it `buildMockupSrcdoc`'s page. jsdom does not run a
// srcdoc, so its `load` events are fired by hand. Placeholders only.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { MockupFrame, mockupFrameProps } from '../src/docs/MockupFrame';
import { MOCKUP_CLICK_GUARD, MOCKUP_CSP, metaFor, mockupCsp } from '../src/docs/mockup/policy';
import type { HttpsOrigin } from '../src/docs/mockup/ports';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const frameOf = (page: string, scripted = false, onNavigated: () => void = () => {}): ReturnType<typeof render> =>
  render(<MockupFrame {...mockupFrameProps(page, scripted, 'Mockup: m.html', onNavigated)} />);

describe('the csp attribute is read back from the page\'s own leading meta (M5.13)', () => {
  it('a meta whose content holds &amp; and &quot; is read back unescaped: the attribute is the policy as written, not the entities', () => {
    const csp = "default-src 'none'; img-src https://cdn.example/?a=1&b=\"2\"";
    const page = metaFor(csp) + MOCKUP_CLICK_GUARD + '<p>x</p>';
    expect(page).toContain('&amp;');
    expect(page).toContain('&quot;');
    const { container } = frameOf(page);
    expect(container.querySelector('iframe')!.getAttribute('csp')).toBe(csp);
  });

  it('&lt; and &gt; are read back too, and an entity that is not one of the four stays as it is', () => {
    const csp = 'default-src <none> & &copy; end';
    const { container } = frameOf(metaFor(csp) + '<p>x</p>');
    expect(container.querySelector('iframe')!.getAttribute('csp')).toBe(csp);
  });

  it('the base policy and a policy with confirmed origins are each equal to their meta\'s policy', () => {
    for (const csp of [MOCKUP_CSP, mockupCsp(['https://cdn.example' as HttpsOrigin, 'https://lib.example' as HttpsOrigin])]) {
      const { container, unmount } = frameOf(metaFor(csp) + MOCKUP_CLICK_GUARD + '<!doctype html><p>x</p>');
      expect(container.querySelector('iframe')!.getAttribute('csp')).toBe(csp);
      expect(container.querySelector('iframe')!.getAttribute('srcdoc')!.startsWith(metaFor(csp))).toBe(true);
      unmount();
    }
  });
});

describe('a page that does not begin with the meta throws, and no frame renders (M5.13)', () => {
  it.each([
    ['no meta at all', '<p>x</p>'],
    ['the doctype first', '<!doctype html>' + metaFor(MOCKUP_CSP)],
    ['a space before the meta', ' ' + metaFor(MOCKUP_CSP)],
    ['another meta first', '<meta charset="utf-8">' + metaFor(MOCKUP_CSP)],
    ['a meta with another http-equiv', '<meta http-equiv="refresh" content="1">'],
    ['an empty page', ''],
  ])('%s', (_name, page) => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    let container: HTMLElement | null = null;
    expect(() => { container = frameOf(page).container; }).toThrow(/does not begin with the Content-Security-Policy meta/);
    expect(container).toBeNull();
    expect(document.querySelector('iframe')).toBeNull();
  });
});

describe('the frame\'s own attributes (M5.13)', () => {
  it('the sandbox attribute is always present: empty while static, exactly allow-scripts while scripted', () => {
    const page = metaFor(MOCKUP_CSP) + '<p>x</p>';
    const a = frameOf(page, false);
    expect(a.container.querySelector('iframe')!.hasAttribute('sandbox')).toBe(true);
    expect(a.container.querySelector('iframe')!.getAttribute('sandbox')).toBe('');
    a.unmount();
    const b = frameOf(page, true);
    expect(b.container.querySelector('iframe')!.getAttribute('sandbox')).toBe('allow-scripts');
  });

  it('the first load is the page; the second calls onNavigated once, and a third calls nothing more', async () => {
    const onNavigated = vi.fn<() => void>();
    const { container } = frameOf(metaFor(MOCKUP_CSP) + '<p>x</p>', false, onNavigated);
    const f = container.querySelector('iframe')!;
    // jsdom fires the page's own load by itself once the frame is mounted: that one is the first.
    await new Promise<void>((r) => { setTimeout(r, 20); });
    expect(onNavigated).not.toHaveBeenCalled();
    fireEvent.load(f);
    expect(onNavigated).toHaveBeenCalledTimes(1);
    fireEvent.load(f);
    expect(onNavigated).toHaveBeenCalledTimes(1);
  });
});
