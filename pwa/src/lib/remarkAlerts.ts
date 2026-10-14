// GitHub-style alert blockquotes (`> [!NOTE]`) as callouts: the remark plugin chat's renderer runs after
// remark-gfm (native Docs reader, W4 Task 2; design 2026-10-01 section 4.9). Moved out of
// `session/MessageBubble.tsx`: `tag()` is byte-identical, and the recursive `walk` became an explicit stack, so a
// deeply nested quote cannot overflow the call stack. The order is the recursive walk's: pre-order, children in
// document order (pushed in reverse), and `tag()` runs BEFORE a node's children are read, because it may shift
// the emptied lead paragraph out of them. `remark-alerts.test.ts` holds it to the old walk as its oracle.
//
// React-free and DOM-free: the parse worker imports it (Task 3's purity test pins the closure).

/** GitHub-style alert blockquotes → callout divs. remark-gfm does NOT do this. */
const ALERT_RE = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i;
export function remarkAlerts(): (tree: unknown) => void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tag = (node: any): void => {
    const p = node.children?.[0];
    if (!p || p.type !== 'paragraph') return;
    const lead = p.children?.[0];
    if (!lead || lead.type !== 'text') return;
    const m = ALERT_RE.exec(lead.value);
    if (!m) return;
    lead.value = lead.value.slice(m[0].length).replace(/^[^\S\n]*\n?/, '');
    if (lead.value === '') {
      p.children.shift();
      if (p.children.length === 0) node.children.shift();
    }
    node.data = { hName: 'div', hProperties: { className: ['callout'], 'data-callout': m[1]!.toLowerCase() } };
  };
  return (tree: unknown): void => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stack: any[] = [tree];
    while (stack.length > 0) {
      const node = stack.pop();
      if (node.type === 'blockquote') tag(node);
      const children = node.children;
      if (children) for (let i = children.length - 1; i >= 0; i -= 1) stack.push(children[i]);
    }
  };
}
