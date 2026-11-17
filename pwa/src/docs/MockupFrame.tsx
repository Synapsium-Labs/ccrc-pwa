// The mockup's frame (native Docs reader, completion plan Task 8, C2; base spec 2026-10-01 5.6.1, 5.6.5, 5.6.6; rows
// M5.13 and M5.15). Ring L4 delivery: ONE `<iframe>` and nothing else, the only place under `pwa/src/docs` besides
// Export's builder that draws one or names `srcdoc` (`docs-scans.test.ts` clause W8a holds the exact path). It decides
// nothing: the page's bytes are `buildMockupSrcdoc`'s, the mode is the caller's, and what it adds is the attribute set
// the standing approvals fix:
//   - `sandbox` is ALWAYS present: `""` while static, exactly `allow-scripts` while scripted, and no other token ever
//     (an absent attribute would mean no sandbox at all);
//   - no `src`, `name`, `allow` or `allowfullscreen`; `referrerpolicy="no-referrer"`;
//   - `csp` is read back from the page's own leading meta, so the attribute and the meta are one policy by
//     construction. A page that does not begin with that meta is a programming error and throws: this never renders a
//     frame without the meta (the leaf's render boundary shows the throw);
//   - the first `load` is the page; any later one means the document navigated, and `onNavigated` runs once. The
//     caller then unmounts the frame and never remounts it by itself.
// There is no `postMessage`, no `MessageChannel` and no message listener here or anywhere in `pwa/src/docs`.
import { useRef, type ReactNode } from 'react';
import { MOCKUP_SANDBOX_SCRIPTED, MOCKUP_SANDBOX_STATIC } from './mockup/policy';

declare module 'react' {
  // `csp` is the iframe attribute browsers read as the embedded-enforcement policy; @types/react does not name it.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface IframeHTMLAttributes<T> {
    csp?: string | undefined;
  }
}

export interface MockupFrameProps {
  /** `buildMockupSrcdoc`'s `page`: `metaFor(csp)`, the click guard, the doctype, then the document. */
  readonly srcdoc: string;
  readonly scripted: boolean;
  readonly title: string;
  onNavigated(): void;
}

/** The props object, built here so the `srcdoc` name stays in this one file (clause W8a). */
export function mockupFrameProps(page: string, scripted: boolean, title: string, onNavigated: () => void): MockupFrameProps {
  return { srcdoc: page, scripted, title, onNavigated };
}

/** The leading meta `metaFor` writes: its `content` holds no `"` (it is escaped), so the first one ends it. */
const LEADING_META = /^<meta http-equiv="Content-Security-Policy" content="([^"]*)">/;
const UNESCAPED: Readonly<Record<string, string>> = { amp: '&', quot: '"', lt: '<', gt: '>' };

/** The policy the page's leading meta carries, unescaped as `metaFor` escaped it. Throws when the page does not begin
 *  with that meta. */
function cspOfPage(page: string): string {
  const m = LEADING_META.exec(page);
  if (m === null) throw new Error('MockupFrame: the page does not begin with the Content-Security-Policy meta');
  return (m[1] ?? '').replace(/&(amp|quot|lt|gt);/g, (_all, name: string) => UNESCAPED[name] ?? _all);
}

export function MockupFrame(p: MockupFrameProps): ReactNode {
  const loads = useRef(0);
  const csp = cspOfPage(p.srcdoc);
  const onLoad = (): void => {
    loads.current += 1;
    if (loads.current === 2) p.onNavigated();
  };
  return (
    <iframe
      className="docs-mockup-frame"
      title={p.title}
      sandbox={p.scripted ? MOCKUP_SANDBOX_SCRIPTED : MOCKUP_SANDBOX_STATIC}
      srcDoc={p.srcdoc}
      referrerPolicy="no-referrer"
      csp={csp}
      onLoad={onLoad}
    />
  );
}
