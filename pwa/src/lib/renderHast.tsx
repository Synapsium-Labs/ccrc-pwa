// A parsed hast tree to React (native Docs reader, W4 Task 4; design 2026-10-01 section 4.10). `renderHast` is
// react-markdown 10.1.0's `post()` (`react-markdown/lib/index.js`, `function post`) minus its raw step, which
// `parseMarkdown` has already taken (every `raw` node is a `text` node by the time a tree reaches here), and minus
// the element filters chat never passes (`allowedElements`, `disallowedElements`, `allowElement`, `skipHtml`).
// What is left, in post()'s order: when `urlTransform` is given, it runs over each `html-url-attributes` key an
// element carries, exactly as post() calls it; then `toJsxRuntime` with post()'s options. Chat passes
// react-markdown's own `defaultUrlTransform`, so a tree from the worker renders byte-identical to `<Markdown>`
// (`render-hast.test.tsx`, M4.P10).
//
// Pure: no hook, no DOM access, no module state, and the input tree is never written. post() transforms its tree
// in place; here the transform builds a copy of the root and of every element (text and comment nodes are
// shared, untouched), with an explicit stack, so a caller can keep and re-render a tree (W5's Export does).
// Without a `urlTransform` the tree is rendered as given and every URL reaches the components unchanged: the
// caller decides (W5's `detachUrls` moves them out first).
import type { ReactElement } from 'react';
import { Fragment, jsx, jsxs } from 'react/jsx-runtime';
import type { Element, Root as HastRoot, RootContent } from 'hast';
import { toJsxRuntime } from 'hast-util-to-jsx-runtime';
import { urlAttributes } from 'html-url-attributes';
import type { Components, UrlTransform } from 'react-markdown';

export interface RenderHastOptions {
  /** The tag-to-component map, as react-markdown's `components` prop (chat passes `CHAT_COMPONENTS`). */
  readonly components: Components;
  /** Applied to every url attribute as react-markdown applies it; absent means the URLs are left as they are. */
  readonly urlTransform?: UrlTransform;
}

/** A copy of `tree` whose url attributes went through `urlTransform`: post()'s url clause, on copies. For each
 *  element, each key of `urlAttributes` present in its own `properties` whose tag list is `null` (every element)
 *  or names the element's tag becomes `urlTransform(String(value || ''), key, element)`. */
function transformUrls(tree: HastRoot, urlTransform: UrlTransform): HastRoot {
  const root: HastRoot = { ...tree, children: [] };
  const stack: { from: readonly RootContent[]; to: RootContent[] }[] = [{ from: tree.children, to: root.children }];
  while (stack.length > 0) {
    const { from, to } = stack.pop()!;
    for (const child of from) {
      if (child.type !== 'element') {
        to.push(child);
        continue;
      }
      const copy: Element = { ...child, properties: { ...child.properties }, children: [] };
      for (const key in urlAttributes) {
        if (Object.hasOwn(urlAttributes, key) && Object.hasOwn(copy.properties, key)) {
          const test = urlAttributes[key];
          if (test === null || test?.includes(copy.tagName)) {
            copy.properties[key] = urlTransform(String(copy.properties[key] || ''), key, copy);
          }
        }
      }
      to.push(copy);
      stack.push({ from: child.children, to: copy.children });
    }
  }
  return root;
}

/** `tree` as React elements, through `components`, with post()'s `toJsxRuntime` options. */
export function renderHast(tree: HastRoot, opts: RenderHastOptions): ReactElement {
  const input = opts.urlTransform === undefined ? tree : transformUrls(tree, opts.urlTransform);
  return toJsxRuntime(input, {
    Fragment,
    jsx,
    jsxs,
    components: opts.components,
    ignoreInvalidStyle: true,
    passKeys: true,
    passNode: true,
  });
}
