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
