import type { Meta, StoryObj } from '@storybook/react-vite';
import { Prose } from './prose';

const meta = {
  title: 'Components/Prose',
  component: Prose,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof Prose>;

export default meta;
type Story = StoryObj<typeof meta>;

/** THE FIRST TIME THIS SURFACE HAS BEEN REVIEWABLE. Every assistant turn of
 *  every session renders through these rules, and until they moved into this
 *  package the only way to see a heading scale was to run the app and wait for
 *  a model to emit one.
 *
 *  The markup is what `react-markdown` produces — MessageBubble still owns the
 *  component map that decides which element each token becomes, so what is
 *  written out here is its OUTPUT, not a second opinion about it.
 *
 *  CHECK the heading scale is four real steps and that each heading binds to
 *  what FOLLOWS it: the top margins are asymmetric on purpose, so a heading
 *  sits closer to its own paragraph than to the one above. */
export const TheScale: Story = {
  args: {
    children: (
      <>
        <h1>What the wave measured</h1>
        <p>
          Five rules in <code>fleet.css</code> declared the same eleven declarations, and the
          stylesheet said so itself — twice, in comments pointing at the other copies.
        </p>
        <h2>The gate did not move</h2>
        <p>
          The shape travelled into the component and the ground stayed in the sheet, so every
          pair the audit measured before it is a pair it measures after.
        </p>
        <h3>A third step</h3>
        <p>Short paragraph under a third-level heading.</p>
        <h4>And a fourth</h4>
        <p>Which is the last one this scale has.</p>
      </>
    ),
  },
};

/** The reading measure, which is the one thing to know about this surface.
 *  `--measure-prose` is 72ch and caps paragraphs, lists and headings — and
 *  deliberately NOT `pre`, tables or images, because data keeps the full pane.
 *
 *  CHECK the paragraph stops short of the code block's right edge. Below 640px
 *  the rule is inert, so this story only shows its point on a wide canvas. */
export const TheMeasure: Story = {
  args: {
    children: (
      <>
        <p>
          A long enough paragraph to reach the measure and stop there, while the block below it
          runs to the full width of the pane because a terminal transcript that wraps at seventy-two
          characters is a transcript nobody can read. The two rules disagree on purpose.
        </p>
        <div className="code-block">
          <div className="code-block-bar">
            <span className="code-block-lang">bash</span>
            <button type="button" className="code-block-copy">copy</button>
          </div>
          <pre><code>$ node design/audit.mjs &amp;&amp; node design/contrast-check.mjs
scanned 8 stylesheets · 12 themes
ALL 3456 PASS</code></pre>
        </div>
      </>
    ),
  },
};

/** Lists, quotes and a table. CHECK the table scrolls sideways INSIDE its own
 *  wrapper rather than widening the page — `.md-table-wrap` is the container
 *  that owns that overflow, and a table that pushes the pane is the defect it
 *  exists to prevent. */
export const Structure: Story = {
  args: {
    children: (
      <>
        <ul>
          <li>A bullet that runs long enough to wrap onto a second line, so the hanging indent is visible.</li>
          <li>A short one.</li>
        </ul>
        <ol>
          <li>Ordered, with its own marker column.</li>
          <li>And a second step.</li>
        </ol>
        <blockquote><p>A quote, set in from the margin with a rule down its left edge.</p></blockquote>
        <div className="md-table-wrap">
          <table>
            <thead><tr><th>rule</th><th>decls</th><th>where</th></tr></thead>
            <tbody>
              <tr><td>.coord-toggle</td><td>11</td><td>fleet.css</td></tr>
              <tr><td>.caps-save</td><td>11</td><td>fleet.css</td></tr>
            </tbody>
          </table>
        </div>
      </>
    ),
  },
};

/** Every list shape the markers have to hold — the preflight's `list-style:
 *  none` kept them all bare until prose.css put the markers back.
 *
 *  CHECK the bullets step disc → circle → square with depth and an ordered
 *  list nested in a bulleted one is still numbered; that `9.` through `11.`
 *  sit inside the column, the two-digit numbers not hanging past its left
 *  edge; that the task list draws its boxes and NO bullet beside them, the
 *  empty box on the surface ground rather than a solid dark square; that a
 *  nested task list drops BELOW its parent's label and steps in, and that only
 *  the item whose own box is checked is dimmed and struck, never its parent
 *  or its children; that in the LOOSE task list (each label its own
 *  paragraph) the done item is dimmed and struck just the same, its box on
 *  its first line; that the quote's numbered list stands apart from the
 *  bullets above it while its heading keeps its own top margin; and that the
 *  number inside the warning callout is legible on its tint.
 *
 *  Each box carries the name the app gives it (`aria-label` "done" or "to do",
 *  `SHARED_COMPONENTS.input` in pwa's `lib/markdown.tsx`): remark-gfm emits it
 *  with no label, and pwa's markdown-task-label.test.tsx holds this mirror to
 *  the app's words. */
export const Lists: Story = {
  args: {
    children: (
      <>
        <ul>
          <li>
            A top-level bullet, a disc.
            <ul>
              <li>
                Nested once: a circle.
                <ul>
                  <li>Nested twice: a square.</li>
                </ul>
              </li>
              <li>
                An ordered list inside a bulleted one is still numbered.
                <ol>
                  <li>First step.</li>
                  <li>Second step.</li>
                </ol>
              </li>
            </ul>
          </li>
        </ul>
        <ol start={9}>
          <li>Starting at nine.</li>
          <li>Ten — the first two-digit number, which must not hang past the column.</li>
          <li>
            Eleven, holding a nested ordered list.
            <ol>
              <li>Its own one.</li>
              <li>Its own two.</li>
            </ol>
          </li>
        </ol>
        <ul className="contains-task-list">
          <li className="task-list-item"><input type="checkbox" checked disabled aria-label="done" /> A finished task.</li>
          <li className="task-list-item">
            <input type="checkbox" disabled aria-label="to do" /> One still open, whose child is done.
            <ul className="contains-task-list">
              <li className="task-list-item"><input type="checkbox" checked disabled aria-label="done" /> The done child.</li>
              <li className="task-list-item">
                <input type="checkbox" disabled aria-label="to do" /> An open child.
                <ul className="contains-task-list">
                  <li className="task-list-item"><input type="checkbox" disabled aria-label="to do" /> An open grandchild.</li>
                </ul>
              </li>
            </ul>
          </li>
          <li className="task-list-item">
            <input type="checkbox" checked disabled aria-label="done" /> A done parent, whose open child is not struck.
            <ul className="contains-task-list">
              <li className="task-list-item"><input type="checkbox" disabled aria-label="to do" /> Still open.</li>
            </ul>
          </li>
        </ul>
        <p>A loose task list, blank lines between its items:</p>
        <ul className="contains-task-list">
          <li className="task-list-item">
            <p><input type="checkbox" checked disabled aria-label="done" /> A loose item that is done, so dimmed and struck.</p>
          </li>
          <li className="task-list-item">
            <p><input type="checkbox" disabled aria-label="to do" /> A loose item still open.</p>
            <p>Its second paragraph, under the label.</p>
          </li>
        </ul>
        <blockquote>
          <p>A quote carrying two lists:</p>
          <ul>
            <li>A bullet.</li>
            <li>Another bullet.</li>
          </ul>
          <ol>
            <li>Then a numbered list, which must read as a second list.</li>
          </ol>
          <h3>A heading in the quote</h3>
          <p>It keeps its own top margin.</p>
        </blockquote>
        <div className="callout" data-callout="warning">
          <p>A callout carrying a list, on its own tint:</p>
          <ol>
            <li>The number takes the callout's body ink.</li>
            <li>Not the page's tertiary one.</li>
          </ol>
        </div>
      </>
    ),
  },
};

/** The callouts, whose five variants are the reason the contrast gate learned
 *  to re-measure a base rule once per variant. CHECK each label's hue against
 *  its own tint — a variant that rebinds `--callout-tint` to the well is the
 *  exact escape the auditor was rewritten to catch. */
export const Callouts: Story = {
  args: {
    children: (
      <>
        {(['note', 'tip', 'important', 'warning', 'caution'] as const).map((kind) => (
          <div key={kind} className="callout" data-callout={kind}>
            <p>A {kind} callout, carrying one sentence.</p>
          </div>
        ))}
      </>
    ),
  },
};
