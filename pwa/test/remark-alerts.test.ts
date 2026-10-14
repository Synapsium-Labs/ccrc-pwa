// M4.M2 (native Docs reader, W4 Task 2; design 2026-10-01 section 4.9 and section 4.15): the iterative
// `remarkAlerts` in `lib/remarkAlerts.ts` against the recursive walk it replaces. `oracleRemarkAlerts` below is the
// plugin `session/MessageBubble.tsx` carried before Task 2, kept VERBATIM (its `tag()` and its recursive `walk`) as
// the oracle, here and nowhere in `src`. Three properties, each with its own case:
//   1. the same output: a differential over generated mdast trees 1 to 40 containers deep;
//   2. the same visiting order: pre-order, children in document order, `tag()` run BEFORE the node's children are
//      read (it may shift the emptied lead paragraph out of them), observed through every `type` read;
//   3. no recursion: a 50 000-deep blockquote chain completes, where the oracle throws `RangeError`.
import { describe, expect, it } from 'vitest';
import { remarkAlerts } from '../src/lib/remarkAlerts';

// ---- the oracle: BASE's MessageBubble.tsx plugin, verbatim ----

/** GitHub-style alert blockquotes → callout divs. remark-gfm does NOT do this. */
const ALERT_RE = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function oracleRemarkAlerts() {
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const walk = (node: any): void => {
    if (node.type === 'blockquote') tag(node);
    if (node.children) for (const c of node.children) walk(c);
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (tree: any): void => walk(tree);
}

// ---- generated mdast ----

interface MdNode {
  type: string;
  value?: string;
  ordered?: boolean;
  children?: MdNode[];
  data?: unknown;
}

const KINDS = ['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION'] as const;
const kind = (k: number): string => KINDS[k % KINDS.length]!;

const text = (value: string): MdNode => ({ type: 'text', value });
const para = (...children: MdNode[]): MdNode => ({ type: 'paragraph', children });
const quote = (...children: MdNode[]): MdNode => ({ type: 'blockquote', children });
const list = (...items: MdNode[]): MdNode => ({
  type: 'list',
  ordered: false,
  children: items.map((c) => ({ type: 'listItem', children: [c] })),
});
const root = (...children: MdNode[]): MdNode => ({ type: 'root', children });

/** The first child a blockquote can open with: every branch `tag()` takes. */
const LEADS: readonly ((k: number) => MdNode)[] = [
  (k) => para(text(`[!${kind(k)}]\nbody ${k}`)), // marker, then the body on the next line
  (k) => para(text(`[!${kind(k).toLowerCase()}] same line ${k}`)), // lower case, body on the marker's line
  () => para(text('[!TIP]')), // the lead empties and so does the paragraph: it is dropped
  () => para(text('[!WARNING]   \n'), { type: 'strong', children: [text('bold')] }), // the lead empties, the paragraph stays
  () => para(text('[!NOTE]   ')), // trailing spaces only: the lead empties
  () => para(text('[!FOO] not an alert kind')),
  () => para(text('a plain quote')),
  () => para({ type: 'emphasis', children: [text('[!NOTE] the lead is not a text node')] }),
  () => ({ type: 'code', value: '[!NOTE]' }), // the first child is not a paragraph
  () => para(), // a paragraph with no children
];
const lead = (i: number, k: number): MdNode => LEADS[i % LEADS.length]!(k);

/** `depth` blockquotes, each opening with lead `i`, the next one inside the previous. */
function chain(depth: number, i: number): MdNode {
  let inner = quote(lead(i, depth));
  for (let d = depth - 1; d >= 1; d -= 1) inner = quote(lead(i, d), inner);
  return root(inner, para(text('after')));
}

/** Quotes inside list items inside quotes, the lead rotating per level. */
function listChain(depth: number): MdNode {
  let inner = quote(lead(depth, depth));
  for (let d = depth - 1; d >= 1; d -= 1) inner = quote(lead(d, d), list(inner, para(text(`item ${d}`))));
  return root(inner);
}

/** At every level an alert, a plain sibling quote, the next level, and a trailing alert sibling. */
function siblings(depth: number): MdNode {
  let inner = quote(lead(0, depth));
  for (let d = depth - 1; d >= 1; d -= 1) {
    inner = quote(lead(d + 2, d), quote(lead(6, d)), inner, quote(lead(1, d + 1)));
  }
  return root(quote(lead(2, 0)), inner, quote(lead(3, 0)));
}

/** Every tree in the family at one depth. */
function family(depth: number): MdNode[] {
  return [...LEADS.map((_, i) => chain(depth, i)), listChain(depth), siblings(depth)];
}

const clone = (t: MdNode): MdNode => JSON.parse(JSON.stringify(t)) as MdNode;

describe('M4.M2: the iterative remarkAlerts matches the recursive walk', () => {
  it('gives the same tree as the oracle for every generated tree 1 to 40 deep', () => {
    let trees = 0;
    let tagged = 0;
    for (let depth = 1; depth <= 40; depth += 1) {
      for (const t of family(depth)) {
        const want = clone(t);
        oracleRemarkAlerts()(want);
        const got = clone(t);
        remarkAlerts()(got);
        expect(got, `depth ${depth}: ${JSON.stringify(t).slice(0, 120)}`).toEqual(want);
        trees += 1;
        tagged += (JSON.stringify(want).match(/"callout"/g) ?? []).length;
      }
    }
    // Not vacuous: the family is 12 trees per depth, and most of them carry alerts.
    expect(trees).toBe(40 * (LEADS.length + 2));
    expect(tagged).toBeGreaterThan(1000);
  });

  it('drops an emptied lead paragraph and keeps a lead paragraph that still has content', () => {
    const t = root(quote(lead(2, 0), para(text('kept'))), quote(lead(3, 0)));
    remarkAlerts()(t);
    expect(t).toEqual(root(
      { ...quote(para(text('kept'))), data: { hName: 'div', hProperties: { className: ['callout'], 'data-callout': 'tip' } } },
      {
        ...quote(para({ type: 'strong', children: [text('bold')] })),
        data: { hName: 'div', hProperties: { className: ['callout'], 'data-callout': 'warning' } },
      },
    ));
  });
});

/** A node whose every `type` read is logged under `id`, so the visiting order is observable. */
function seen(log: string[], id: string, type: string, rest: Omit<MdNode, 'type'> = {}): MdNode {
  const node = { ...rest } as MdNode;
  Object.defineProperty(node, 'type', {
    enumerable: true,
    get: () => {
      log.push(id);
      return type;
    },
  });
  return node;
}

/** root > [A: alert whose lead paragraph empties, holding B: an alert; C: a plain quote]. */
function orderTree(log: string[]): MdNode {
  const s = (id: string, type: string, rest?: Omit<MdNode, 'type'>): MdNode => seen(log, id, type, rest);
  return s('root', 'root', {
    children: [
      s('A', 'blockquote', {
        children: [
          s('A.p', 'paragraph', { children: [s('A.p.t', 'text', { value: '[!TIP]' })] }),
          s('B', 'blockquote', {
            children: [s('B.p', 'paragraph', { children: [s('B.p.t', 'text', { value: '[!NOTE] inner' })] })],
          }),
        ],
      }),
      s('C', 'blockquote', {
        children: [s('C.p', 'paragraph', { children: [s('C.p.t', 'text', { value: 'plain' })] })],
      }),
    ],
  });
}

describe('M4.M2: the visiting order is the recursive walk\'s', () => {
  // Every `type` read, in order: the walk reads a node's type when it visits it, and `tag()` reads its lead
  // paragraph's and lead text's. A's emptied paragraph is shifted out by `tag(A)` BEFORE A's children are read,
  // so `A.p` is never visited after `A.p.t`; children are visited in document order, so C comes last.
  const ORDER = [
    'root',
    'A', 'A.p', 'A.p.t',
    'B', 'B.p', 'B.p.t', 'B.p', 'B.p.t',
    'C', 'C.p', 'C.p.t', 'C.p', 'C.p.t',
  ];

  it('the oracle reads types in exactly this order', () => {
    const log: string[] = [];
    oracleRemarkAlerts()(orderTree(log));
    expect(log).toEqual(ORDER);
  });

  it('remarkAlerts reads types in the same order: pre-order, document order, tag before children', () => {
    const log: string[] = [];
    remarkAlerts()(orderTree(log));
    expect(log).toEqual(ORDER);
  });
});

// ---- depth: the iterative walk has no recursion limit ----

const DEEP = 50_000;

/** `depth` nested alert blockquotes, built iteratively (a recursive builder would overflow first). */
function deepQuotes(depth: number): MdNode {
  const tree = root();
  let parent = tree;
  for (let i = 0; i < depth; i += 1) {
    const q = quote(para(text(`[!${kind(i)}] level ${i}`)));
    parent.children!.push(q);
    parent = q;
  }
  return tree;
}

/** Walks the chain iteratively: how many blockquotes, how many tagged with their own kind and stripped lead. */
function census(tree: MdNode): { quotes: number; tagged: number } {
  let quotes = 0;
  let tagged = 0;
  let node: MdNode | undefined = tree.children?.[0];
  while (node !== undefined) {
    const lvl = quotes;
    quotes += 1;
    const data = node.data as { hProperties?: { 'data-callout'?: string } } | undefined;
    const leadText = node.children?.[0]?.children?.[0]?.value;
    if (data?.hProperties?.['data-callout'] === kind(lvl).toLowerCase() && leadText === `level ${lvl}`) tagged += 1;
    node = node.children?.[1];
  }
  return { quotes, tagged };
}

describe('M4.M2: a 50 000-deep blockquote chain', () => {
  it('control: the recursive oracle throws RangeError on it', () => {
    expect(() => oracleRemarkAlerts()(deepQuotes(DEEP))).toThrow(RangeError);
  });

  it('remarkAlerts completes and tags every level', () => {
    const tree = deepQuotes(DEEP);
    expect(() => remarkAlerts()(tree)).not.toThrow();
    expect(census(tree)).toEqual({ quotes: DEEP, tagged: DEEP });
  });
});
